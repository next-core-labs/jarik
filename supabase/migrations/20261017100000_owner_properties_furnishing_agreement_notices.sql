-- Owners register their own property (a single apartment/villa, or a building/tower with its
-- apartments), every unit carries its deed and a furniture inventory, and a management request to an
-- office now reaches that office as a notification it can accept or reject (with a reason).
--
-- An owner-registered property is the one with org_id NULL and owner_id = the owner: no office manages
-- it until the owner's management agreement with an office is accepted (then the office sees it through
-- the existing agreement policies — org_isolation_select / property_agreement_view_ok).

-- ── 1. Building and unit specifications ──────────────────────────────────────────────────────────
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS structure text NOT NULL DEFAULT 'building',
  ADD COLUMN IF NOT EXISTS building_type text,
  ADD COLUMN IF NOT EXISTS floors_count integer,
  ADD COLUMN IF NOT EXISTS year_built integer,
  ADD COLUMN IF NOT EXISTS elevators integer,
  ADD COLUMN IF NOT EXISTS parking_spaces integer;

ALTER TABLE public.properties
  DROP CONSTRAINT IF EXISTS properties_structure_check,
  ADD CONSTRAINT properties_structure_check CHECK (structure IN ('single', 'building')),
  DROP CONSTRAINT IF EXISTS properties_specs_check,
  ADD CONSTRAINT properties_specs_check CHECK (
    (floors_count IS NULL OR floors_count BETWEEN 0 AND 300)
    AND (year_built IS NULL OR year_built BETWEEN 1900 AND 2100)
    AND (elevators IS NULL OR elevators BETWEEN 0 AND 100)
    AND (parking_spaces IS NULL OR parking_spaces BETWEEN 0 AND 10000)
  );

COMMENT ON COLUMN public.properties.structure IS
  'single = one standalone unit (apartment, villa, floor…); building = a building/tower/compound of several units';

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS deed_number text,
  ADD COLUMN IF NOT EXISTS furnishing text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS furniture jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS furniture_notes text;

ALTER TABLE public.units
  DROP CONSTRAINT IF EXISTS units_furnishing_check,
  ADD CONSTRAINT units_furnishing_check CHECK (furnishing IN ('none', 'partial', 'full')),
  DROP CONSTRAINT IF EXISTS units_furniture_check,
  ADD CONSTRAINT units_furniture_check CHECK (
    jsonb_typeof(furniture) = 'array' AND jsonb_array_length(furniture) <= 200
    AND (furniture_notes IS NULL OR length(furniture_notes) <= 2000)
  );

COMMENT ON COLUMN public.units.furniture IS
  'Furniture inventory: [{"name": "مكيف سبليت", "qty": 3}, …]';

UPDATE public.units SET furnishing = 'full' WHERE furnished AND furnishing = 'none';

-- `furnished` stays the market/search flag; it follows `furnishing`, and an older writer that only
-- sets `furnished` still moves `furnishing` with it.
CREATE OR REPLACE FUNCTION private.sync_unit_furnishing()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.furnishing IS NOT DISTINCT FROM OLD.furnishing
     AND NEW.furnished IS DISTINCT FROM OLD.furnished THEN
    NEW.furnishing := CASE WHEN NEW.furnished THEN 'full' ELSE 'none' END;
  ELSIF TG_OP = 'INSERT' AND NEW.furnished AND NEW.furnishing = 'none' THEN
    NEW.furnishing := 'full';
  END IF;
  NEW.furnished := NEW.furnishing <> 'none';
  IF NEW.furnishing = 'none' THEN
    NEW.furniture := '[]'::jsonb;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a1_sync_furnishing ON public.units;
CREATE TRIGGER a1_sync_furnishing BEFORE INSERT OR UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION private.sync_unit_furnishing();

-- ── 2. Owners write their own (office-less) properties and units ─────────────────────────────────
CREATE OR REPLACE FUNCTION private.owner_managed_property(_property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = _property_id AND p.org_id IS NULL AND p.owner_id = auth.uid()
  )
$$;

-- An owner's own property must not be attributed to an office (it used to fall back to the oldest one).
CREATE OR REPLACE FUNCTION private.fill_property_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL
     AND NOT (auth.uid() IS NOT NULL AND NEW.owner_id = auth.uid() AND NOT public.is_staff(auth.uid())) THEN
    NEW.org_id := COALESCE(public.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;

DROP POLICY IF EXISTS properties_owner_write ON public.properties;
CREATE POLICY properties_owner_write ON public.properties FOR ALL TO authenticated
  USING (owner_id = auth.uid() AND org_id IS NULL AND public.has_role(auth.uid(), 'owner'))
  WITH CHECK (owner_id = auth.uid() AND org_id IS NULL AND public.has_role(auth.uid(), 'owner'));

DROP POLICY IF EXISTS units_owner_write ON public.units;
CREATE POLICY units_owner_write ON public.units FOR ALL TO authenticated
  USING (private.owner_managed_property(property_id) AND public.has_role(auth.uid(), 'owner'))
  WITH CHECK (private.owner_managed_property(property_id) AND public.has_role(auth.uid(), 'owner'));

-- What an owner may not set on their own unit: occupancy (from leases), market publication and
-- pricing automation (the managing office's job), and featuring (the platform's).
CREATE OR REPLACE FUNCTION private.guard_owner_unit_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL OR public.is_staff(uid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT private.owner_managed_property(OLD.property_id) THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM public.leases WHERE unit_id = OLD.id) THEN
      RAISE EXCEPTION 'لا يمكن حذف وحدة لها عقود إيجار مسجّلة' USING ERRCODE = '23503';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.agreement_units au
      JOIN public.management_agreements a ON a.id = au.agreement_id
      WHERE au.unit_id = OLD.id AND a.status IN ('sent', 'office_modified', 'active')
    ) THEN
      RAISE EXCEPTION 'الوحدة مشمولة باتفاقية إدارة — أنهِ الاتفاقية أو انتظر ردّ المكتب أولًا'
        USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;

  IF NOT private.owner_managed_property(NEW.property_id) THEN RETURN NEW; END IF;

  NEW.owner_id := uid;
  IF TG_OP = 'INSERT' THEN
    NEW.status := 'vacant';
    NEW.tenant_id := NULL;
    NEW.market_listed := false;
    NEW.market_listed_at := NULL;
    NEW.featured := false;
    NEW.featured_at := NULL;
    NEW.auto_price_decay := false;
    NEW.price_floor := NULL;
  ELSE
    NEW.status := OLD.status;
    NEW.tenant_id := OLD.tenant_id;
    NEW.market_listed := OLD.market_listed;
    NEW.market_listed_at := OLD.market_listed_at;
    NEW.featured := OLD.featured;
    NEW.featured_at := OLD.featured_at;
    NEW.auto_price_decay := OLD.auto_price_decay;
    NEW.price_floor := OLD.price_floor;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a0_guard_owner_unit ON public.units;
CREATE TRIGGER a0_guard_owner_unit BEFORE INSERT OR UPDATE OR DELETE ON public.units
  FOR EACH ROW EXECUTE FUNCTION private.guard_owner_unit_write();

-- Deleting a property cascades to its units after the property row is gone, so the unit guard can no
-- longer tell it was the owner's: check the same conditions here first.
CREATE OR REPLACE FUNCTION private.guard_owner_property_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) OR OLD.org_id IS NOT NULL
     OR OLD.owner_id IS DISTINCT FROM auth.uid() THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.units u JOIN public.leases l ON l.unit_id = u.id WHERE u.property_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'لا يمكن حذف عقار لوحداته عقود إيجار مسجّلة' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.units u
    JOIN public.agreement_units au ON au.unit_id = u.id
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE u.property_id = OLD.id AND a.status IN ('sent', 'office_modified', 'active')
  ) THEN
    RAISE EXCEPTION 'إحدى وحدات العقار مشمولة باتفاقية إدارة — أنهِ الاتفاقية أو انتظر ردّ المكتب أولًا'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS a0_guard_owner_property_delete ON public.properties;
CREATE TRIGGER a0_guard_owner_property_delete BEFORE DELETE ON public.properties
  FOR EACH ROW EXECUTE FUNCTION private.guard_owner_property_delete();

-- ── 3. Public listings: an owner's property is advertised only by the office managing it ─────────
CREATE OR REPLACE FUNCTION private.unit_agreement_org(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.org_id
  FROM public.agreement_units au
  JOIN public.management_agreements a ON a.id = au.agreement_id
  WHERE au.unit_id = _unit_id AND a.status = 'active'
    AND (a.termination_requested_at IS NULL
         OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  ORDER BY a.created_at DESC
  LIMIT 1
$$;

-- Same columns as 20261016120000_listing_office_from_property.sql plus furnishing/furniture at the end.
-- Only the office of an owner-registered property (org_id NULL, owner set) changes: the office with an
-- active management agreement on the unit, or none (not listed) — never an office the owner merely
-- used to be a client of, nor the oldest office on the platform.
CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp,
  round(p.lat::numeric, 2) AS lat, round(p.lng::numeric, 2) AS lng,
  u.featured,
  CASE
    WHEN u.list_price > CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END
    THEN u.list_price
  END AS list_price,
  u.furnishing,
  u.furniture
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = CASE
  WHEN p.org_id IS NOT NULL THEN p.org_id
  WHEN p.owner_id IS NOT NULL THEN private.unit_agreement_org(u.id)
  ELSE COALESCE(
    (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id AND m.kind = 'member' LIMIT 1),
    (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id LIMIT 1),
    (SELECT s.id FROM public.org_settings s WHERE s.listed_publicly AND s.verified ORDER BY s.created_at LIMIT 1)
  )
END
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- ── 4. Agreement messages: owner's note to the office, office's reason back ──────────────────────
ALTER TABLE public.management_agreements
  ADD COLUMN IF NOT EXISTS owner_note text,
  ADD COLUMN IF NOT EXISTS office_note text;
ALTER TABLE public.management_agreements
  DROP CONSTRAINT IF EXISTS management_agreements_notes_check,
  ADD CONSTRAINT management_agreements_notes_check CHECK (
    (owner_note IS NULL OR length(owner_note) <= 1000)
    AND (office_note IS NULL OR length(office_note) <= 1000)
  );

-- Every staff member of the office (not its clients) gets the notification.
CREATE OR REPLACE FUNCTION private.notify_org_staff(
  _org uuid, _title text, _body text, _kind text, _table text, _id uuid
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  SELECT m.user_id, _org, _title, _body, _kind, 'system', _table, _id
  FROM public.org_members m
  WHERE m.org_id = _org AND m.kind = 'member' AND public.is_staff(m.user_id)
$$;

DROP FUNCTION IF EXISTS public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[]);
DROP FUNCTION IF EXISTS public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[], text);
CREATE FUNCTION public.request_management_agreement(
  _org_id uuid, _unit_ids uuid[], _commission_type text, _commission_value numeric,
  _start_date date, _end_date date, _notice_period_days integer, _maintenance_cap numeric,
  _permissions text[], _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE agreement_id uuid; uid uuid := auth.uid(); uid_check uuid; owner_label text; n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF _unit_ids IS NULL OR array_length(_unit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'اختر وحدة واحدة على الأقل' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_settings WHERE id = _org_id AND verified) THEN
    RAISE EXCEPTION 'المكتب غير متاح لاستقبال الطلبات' USING ERRCODE = '22023';
  END IF;

  -- كل وحدة لازم تكون فعلاً مملوكة لمن يطلب — مالك الوحدة نفسها، وإلا مالك عقارها.
  SELECT u.id INTO uid_check
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = ANY(_unit_ids) AND COALESCE(u.owner_id, p.owner_id) IS DISTINCT FROM uid
  LIMIT 1;
  IF uid_check IS NOT NULL THEN
    RAISE EXCEPTION 'إحدى الوحدات ليست مملوكة لك' USING ERRCODE = '42501';
  END IF;

  -- ولا وحدة منها لها اتفاقية سارية حاليًا (مع أي مكتب) — الطلبات المعلّقة لمكاتب أخرى مسموحة.
  IF EXISTS (
    SELECT 1 FROM public.agreement_units au
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE au.unit_id = ANY(_unit_ids) AND a.status = 'active'
      AND (a.termination_requested_at IS NULL
           OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  ) THEN
    RAISE EXCEPTION 'إحدى الوحدات لها اتفاقية سارية بالفعل' USING ERRCODE = '23505';
  END IF;

  -- ولا طلب ثانٍ لنفس المكتب على نفس الوحدة وهو ما زال بانتظار الرد.
  IF EXISTS (
    SELECT 1 FROM public.agreement_units au
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE au.unit_id = ANY(_unit_ids) AND a.org_id = _org_id AND a.owner_id = uid
      AND a.status IN ('sent', 'office_modified')
  ) THEN
    RAISE EXCEPTION 'لديك طلب بانتظار ردّ هذا المكتب على إحدى هذه الوحدات' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.management_agreements
    (org_id, owner_id, status, initiated_by, commission_type, commission_value,
     start_date, end_date, notice_period_days, maintenance_cap, owner_note)
  VALUES
    (_org_id, uid, 'sent', 'owner', _commission_type, _commission_value,
     _start_date, _end_date, COALESCE(_notice_period_days, 30), _maintenance_cap,
     NULLIF(btrim(_note), ''))
  RETURNING id INTO agreement_id;

  INSERT INTO public.agreement_units (agreement_id, unit_id)
  SELECT DISTINCT agreement_id, u FROM unnest(_unit_ids) AS u;

  IF _permissions IS NOT NULL THEN
    INSERT INTO public.agreement_permissions (agreement_id, permission)
    SELECT agreement_id, p FROM unnest(_permissions) AS p;
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'مالك') INTO owner_label FROM public.profiles WHERE id = uid;
  n := (SELECT count(DISTINCT u) FROM unnest(_unit_ids) AS u);
  PERFORM private.notify_org_staff(
    _org_id,
    'طلب إدارة أملاك جديد',
    COALESCE(owner_label, 'مالك') || ' يطلب من مكتبك إدارة ' || n || ' وحدة — راجع الطلب واقبله أو ارفضه.',
    'agreement', 'management_agreements', agreement_id);

  RETURN agreement_id;
END $$;
REVOKE ALL ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[], text) TO authenticated;

DROP FUNCTION IF EXISTS public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[]);
DROP FUNCTION IF EXISTS public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text);
CREATE FUNCTION public.office_respond_agreement(
  _agreement_id uuid, _decision text, _commission_value numeric DEFAULT NULL,
  _notice_period_days integer DEFAULT NULL, _maintenance_cap numeric DEFAULT NULL,
  _permissions text[] DEFAULT NULL, _note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; conflict_unit uuid; note text := NULLIF(btrim(_note), '');
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الاتفاقية غير موجودة' USING ERRCODE = '02000'; END IF;
  IF NOT public.is_staff(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'هذا الطلب ليس لمكتبك' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('sent') THEN
    RAISE EXCEPTION 'الطلب ليس بانتظار ردّ المكتب' USING ERRCODE = '22023';
  END IF;

  IF _decision = 'reject' THEN
    UPDATE public.management_agreements SET status = 'rejected', office_note = note
    WHERE id = _agreement_id;
    RETURN;
  END IF;

  IF _decision = 'counter' THEN
    UPDATE public.management_agreements SET
      status = 'office_modified',
      commission_value = COALESCE(_commission_value, commission_value),
      notice_period_days = COALESCE(_notice_period_days, notice_period_days),
      maintenance_cap = COALESCE(_maintenance_cap, maintenance_cap),
      office_note = note
    WHERE id = _agreement_id;
    IF _permissions IS NOT NULL THEN
      DELETE FROM public.agreement_permissions WHERE agreement_id = _agreement_id;
      INSERT INTO public.agreement_permissions (agreement_id, permission)
      SELECT _agreement_id, p FROM unnest(_permissions) AS p;
    END IF;
    RETURN;
  END IF;

  IF _decision = 'accept' THEN
    SELECT au.unit_id INTO conflict_unit
    FROM public.agreement_units au
    JOIN public.management_agreements a2 ON a2.id = au.agreement_id
    WHERE au.agreement_id <> _agreement_id
      AND au.unit_id IN (SELECT unit_id FROM public.agreement_units WHERE agreement_id = _agreement_id)
      AND a2.status = 'active'
      AND (a2.termination_requested_at IS NULL
           OR now() < a2.termination_requested_at + make_interval(days => a2.notice_period_days))
    LIMIT 1;
    IF conflict_unit IS NOT NULL THEN
      RAISE EXCEPTION 'إحدى الوحدات صار لها اتفاقية سارية مع مكتب آخر بين طلب الاتفاقية والقبول'
        USING ERRCODE = '23505';
    END IF;
    UPDATE public.management_agreements SET
      status = 'active',
      office_note = note,
      accepted_snapshot = to_jsonb(a) || jsonb_build_object('accepted_at', now())
    WHERE id = _agreement_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'قرار غير معروف' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text) TO authenticated;

-- Each side hears about the other's decision.
CREATE OR REPLACE FUNCTION private.notify_agreement_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE office text; owner_label text; reason text;
BEGIN
  SELECT company_name INTO office FROM public.org_settings WHERE id = NEW.org_id;
  office := COALESCE(NULLIF(btrim(office), ''), 'المكتب');
  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'المالك') INTO owner_label
  FROM public.profiles WHERE id = NEW.owner_id;
  owner_label := COALESCE(owner_label, 'المالك');
  reason := CASE WHEN NEW.office_note IS NOT NULL THEN ' — ' || NEW.office_note ELSE '' END;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'sent' AND NEW.status = 'active' THEN
      INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
      VALUES (NEW.owner_id, 'قَبِل ' || office || ' طلب الإدارة',
              'الاتفاقية سارية الآن والمكتب يدير وحداتك بالصلاحيات التي حدّدتها.' || reason,
              'agreement', 'system', 'management_agreements', NEW.id);
    ELSIF OLD.status = 'sent' AND NEW.status = 'rejected' THEN
      INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
      VALUES (NEW.owner_id, 'اعتذر ' || office || ' عن طلب الإدارة',
              'يمكنك إرسال الطلب لمكتب آخر قريب من عقارك.' || reason,
              'agreement', 'system', 'management_agreements', NEW.id);
    ELSIF OLD.status = 'sent' AND NEW.status = 'office_modified' THEN
      INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
      VALUES (NEW.owner_id, 'عدّل ' || office || ' شروط الاتفاقية',
              'راجع الشروط الجديدة واقبلها أو ارفضها.' || reason,
              'agreement', 'system', 'management_agreements', NEW.id);
    ELSIF OLD.status = 'office_modified' AND NEW.status = 'active' THEN
      PERFORM private.notify_org_staff(NEW.org_id, 'وافق ' || owner_label || ' على الشروط المعدّلة',
        'الاتفاقية سارية الآن — وحدات المالك ظاهرة في «الأملاك والوحدات».',
        'agreement', 'management_agreements', NEW.id);
    ELSIF OLD.status = 'office_modified' AND NEW.status = 'rejected' THEN
      PERFORM private.notify_org_staff(NEW.org_id, 'رفض ' || owner_label || ' الشروط المعدّلة',
        'انتهى طلب الإدارة دون اتفاق.', 'agreement', 'management_agreements', NEW.id);
    END IF;
  END IF;

  IF NEW.termination_requested_at IS NOT NULL AND OLD.termination_requested_at IS NULL THEN
    IF NEW.termination_requested_by = 'owner' THEN
      PERFORM private.notify_org_staff(NEW.org_id, owner_label || ' طلب إنهاء اتفاقية الإدارة',
        'تبقى الاتفاقية سارية ' || NEW.notice_period_days || ' يومًا (فترة الإشعار).',
        'agreement', 'management_agreements', NEW.id);
    ELSE
      INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
      VALUES (NEW.owner_id, office || ' طلب إنهاء اتفاقية الإدارة',
              'تبقى الاتفاقية سارية ' || NEW.notice_period_days || ' يومًا (فترة الإشعار).',
              'agreement', 'system', 'management_agreements', NEW.id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS notify_agreement_change ON public.management_agreements;
CREATE TRIGGER notify_agreement_change
  AFTER UPDATE OF status, termination_requested_at ON public.management_agreements
  FOR EACH ROW EXECUTE FUNCTION private.notify_agreement_change();

-- The office sees what it is asked to manage before deciding: every unit's specs, for every status
-- (not just once active), plus the owner's note.
DROP FUNCTION IF EXISTS public.office_agreement_requests();
CREATE FUNCTION public.office_agreement_requests()
RETURNS TABLE(id uuid, owner_name text, owner_email text, status text, commission_type text,
  commission_value numeric, start_date date, end_date date, notice_period_days integer,
  maintenance_cap numeric, termination_requested_at timestamptz, termination_requested_by text,
  units_count bigint, units jsonb, permissions text[], created_at timestamptz,
  owner_note text, office_note text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := public.my_org_id();
BEGIN
  -- أي موظف من المكتب، لا مدير حصرًا — يطابق تمامًا صلاحية البتّ الفعلية في
  -- office_respond_agreement() (is_staff() + عضوية بالمكتب، بلا شرط is_office_manager).
  IF org IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه الشاشة لموظفي المكتب' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id, pr.full_name, u.email::text, a.status, a.commission_type, a.commission_value,
    a.start_date, a.end_date, a.notice_period_days, a.maintenance_cap,
    a.termination_requested_at, a.termination_requested_by,
    (SELECT count(*) FROM public.agreement_units au WHERE au.agreement_id = a.id),
    -- No deed or meter numbers before the office is actually managing the units.
    (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'unit_id', un.id, 'unit_number', un.unit_number, 'unit_name', un.unit_name,
        'unit_type', un.unit_type, 'property_name', p.name, 'property_structure', p.structure,
        'city', p.city, 'district', COALESCE(NULLIF(un.district, ''), p.district),
        'floor_no', un.floor_no, 'area', un.area, 'rooms', un.rooms, 'halls', un.halls,
        'bathrooms', un.bathrooms, 'furnishing', un.furnishing, 'furniture', un.furniture,
        'annual_rent', un.annual_rent, 'listing_purpose', un.listing_purpose,
        'sale_price', un.sale_price, 'status', un.status,
        'deed_number', CASE WHEN a.status = 'active' THEN un.deed_number END
      ) ORDER BY p.name, un.unit_number), '[]'::jsonb)
     FROM public.agreement_units au
     JOIN public.units un ON un.id = au.unit_id
     JOIN public.properties p ON p.id = un.property_id
     WHERE au.agreement_id = a.id),
    COALESCE(
      (SELECT array_agg(ap.permission) FROM public.agreement_permissions ap WHERE ap.agreement_id = a.id),
      '{}'),
    a.created_at,
    a.owner_note,
    a.office_note
  FROM public.management_agreements a
  JOIN auth.users u ON u.id = a.owner_id
  LEFT JOIN public.profiles pr ON pr.id = a.owner_id
  -- 'rejected' مُضمَّنة أيضًا (لا 'cancelled' — تلك حالة نادرة قبل أي رد من المكتب) حتى تبقى شاشة
  -- المكتب مطابقة لشاشة المالك (owner.agreements.tsx تعرض تاريخها كاملًا بلا فلتر) بدل ما يختفي
  -- طلب رفضه المكتب توًا من كل مكان بلا أثر.
  WHERE a.org_id = org AND a.status IN ('sent', 'office_modified', 'active', 'rejected')
  ORDER BY (a.status = 'active') ASC, (a.status = 'rejected') ASC, a.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.office_agreement_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_agreement_requests() TO authenticated;

-- ── 5. Offices near a property ───────────────────────────────────────────────────────────────────
-- An office has no address pin of its own, so its position is the centre of the properties it manages.
-- Only the rounded distance leaves the function, never that centre. Same offices as office_directory.
CREATE OR REPLACE FUNCTION public.offices_near(
  _lat double precision DEFAULT NULL, _lng double precision DEFAULT NULL,
  _city text DEFAULT NULL, _district text DEFAULT NULL
) RETURNS TABLE(id uuid, company_name text, fal_license_no text, office_phone text, city text,
  district text, logo_url text, distance_km numeric, same_city boolean, same_district boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH centre AS (
    SELECT p.org_id, avg(p.lat) AS lat, avg(p.lng) AS lng
    FROM public.properties p
    WHERE p.org_id IS NOT NULL AND p.lat IS NOT NULL AND p.lng IS NOT NULL
    GROUP BY p.org_id
  ), ranked AS (
    SELECT o.id, o.company_name, o.fal_license_no, o.office_phone, o.city, o.district, o.logo_url,
      CASE WHEN _lat IS NOT NULL AND _lng IS NOT NULL AND c.lat IS NOT NULL THEN
        round((6371 * 2 * asin(sqrt(
          power(sin(radians(c.lat - _lat) / 2), 2)
          + cos(radians(_lat)) * cos(radians(c.lat)) * power(sin(radians(c.lng - _lng) / 2), 2)
        )))::numeric, 1)
      END AS distance_km,
      COALESCE(NULLIF(btrim(_city), '') IS NOT NULL AND btrim(o.city) = btrim(_city), false) AS same_city,
      -- District names repeat across cities («النسيم» is in Riyadh and Jeddah): same city too.
      COALESCE(NULLIF(btrim(_district), '') IS NOT NULL AND btrim(o.district) = btrim(_district)
        AND (NULLIF(btrim(_city), '') IS NULL OR btrim(o.city) = btrim(_city)), false) AS same_district
    FROM public.org_settings o
    LEFT JOIN centre c ON c.org_id = o.id
    WHERE o.listed_publicly AND o.verified AND auth.uid() IS NOT NULL
  )
  SELECT * FROM ranked
  ORDER BY same_district DESC, distance_km ASC NULLS LAST, same_city DESC, company_name
$$;
REVOKE ALL ON FUNCTION public.offices_near(double precision, double precision, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.offices_near(double precision, double precision, text, text) TO authenticated;
