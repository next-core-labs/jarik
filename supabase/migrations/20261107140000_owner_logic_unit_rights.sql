-- Who may change what on a unit while an office manages it, and no unit registered twice.
--
-- 1. The owner of an owner-registered unit (guard_owner_unit_write): while a live management agreement
--    holds the unit, the fields that agreement hands to the office are the office's — annual_rent and
--    sale_price with `pricing`; the advert (listing_description, amenities) and office notes with `leasing`. With no live
--    agreement the owner may take the unit off the website and stop automatic price cuts (never switch
--    either on: publishing is paid by an office). Deleting is blocked only by a pending request or a
--    signed agreement that hasn't run out (P1's private.unit_agreement_blocks_delete).
-- 2. The office managing an owner-registered unit under an agreement (guard_unit_agreement_columns):
--    the deed number and the furniture inventory are the owner's record, whatever the permissions.
--    An account that is staff AND owner is treated as the owner on its own office-less properties
--    (20261107110000 lets it keep them): the owner guards apply to it, the agreement guard doesn't.
-- 3. Duplicates: a unit number appears once per property, a unit deed in one property only, a property
--    deed on one property only (digits compared, Arabic or Latin). Live data had none when this was
--    written (checked 2026-11-07), but per the no-failing-constraint rule they are enforced by triggers
--    that check NEW values only — an existing row is never blocked unless its own number/deed changes.
-- 4. unit_management(): the browser asks the database who manages a unit and what that office may edit,
--    instead of re-deriving "live agreement" from the agreement rows.
--
-- Depends on 20261107100000 (P1): private.unit_agreement_blocks_delete(uuid) and the live-aware
-- private.unit_agreement_org(uuid) / private.agreement_permission(uuid, uuid, text) (both NULL/false
-- for units of office-registered properties).

-- ── 1. The owner's writes ────────────────────────────────────────────────────────────────────────
-- Based on 20261017100000 (identical to live); INSERT branch unchanged. Staff skip it only on a
-- property that isn't their own office-less one.
CREATE OR REPLACE FUNCTION private.guard_owner_unit_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); office uuid; prop uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN prop := OLD.property_id; ELSE prop := NEW.property_id; END IF;
  IF uid IS NULL OR (public.is_staff(uid) AND NOT private.owner_managed_property(prop)) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF NOT private.owner_managed_property(OLD.property_id) THEN RETURN OLD; END IF;
    IF EXISTS (SELECT 1 FROM public.leases WHERE unit_id = OLD.id) THEN
      RAISE EXCEPTION 'لا يمكن حذف وحدة لها عقود إيجار مسجّلة' USING ERRCODE = '23503';
    END IF;
    IF private.unit_agreement_blocks_delete(OLD.id) THEN
      RAISE EXCEPTION 'الوحدة مشمولة باتفاقية إدارة سارية أو طلب بانتظار الرد — اسحب الطلب أو أنهِ الاتفاقية أولًا'
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
    RETURN NEW;
  END IF;

  office := private.unit_agreement_org(OLD.id);

  NEW.status := OLD.status;
  NEW.tenant_id := OLD.tenant_id;
  NEW.market_listed_at := OLD.market_listed_at;
  NEW.featured := OLD.featured;
  NEW.featured_at := OLD.featured_at;
  NEW.price_floor := OLD.price_floor;
  -- Off only, and only when no office manages the unit any more.
  IF NOT (office IS NULL AND OLD.market_listed AND NOT NEW.market_listed) THEN
    NEW.market_listed := OLD.market_listed;
  END IF;
  IF NOT (office IS NULL AND OLD.auto_price_decay AND NOT NEW.auto_price_decay) THEN
    NEW.auto_price_decay := OLD.auto_price_decay;
  END IF;

  IF office IS NOT NULL THEN
    IF (NEW.annual_rent, NEW.sale_price) IS DISTINCT FROM (OLD.annual_rent, OLD.sale_price)
       AND private.agreement_permission(OLD.id, office, 'pricing') THEN
      RAISE EXCEPTION 'الإيجار وسعر البيع يحدّدهما المكتب الذي يدير الوحدة حسب اتفاقية الإدارة — اطلب منه تعديلهما'
        USING ERRCODE = '42501';
    END IF;
    IF (NEW.listing_description, NEW.amenities, NEW.notes)
         IS DISTINCT FROM (OLD.listing_description, OLD.amenities, OLD.notes)
       AND private.agreement_permission(OLD.id, office, 'leasing') THEN
      RAISE EXCEPTION 'وصف الإعلان والمزايا والملاحظات يتولاها المكتب الذي يدير الوحدة حسب اتفاقية الإدارة'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── 2. The agreement office's writes ─────────────────────────────────────────────────────────────
-- Based on 20260924135836 (identical to live); new: the deed/furniture rule, and a staff account
-- editing its own office-less property is the owner there (guard_owner_unit_write applies instead).
CREATE OR REPLACE FUNCTION private.guard_unit_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid())
     OR private.staff_scope_ok(private.org_of_property(OLD.property_id))
     OR private.owner_managed_property(OLD.property_id) THEN
    RETURN NEW;
  END IF;
  IF NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'لا يمكن نقل الوحدة لعقار آخر عبر اتفاقية إدارة' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير مالك الوحدة عبر اتفاقية إدارة' USING ERRCODE = '42501';
  END IF;
  -- An owner-registered unit's deed and furniture inventory are the owner's record.
  IF private.org_of_property(OLD.property_id) IS NULL
     AND (NEW.deed_number, NEW.furnishing, NEW.furnished, NEW.furniture, NEW.furniture_notes)
         IS DISTINCT FROM (OLD.deed_number, OLD.furnishing, OLD.furnished, OLD.furniture, OLD.furniture_notes) THEN
    RAISE EXCEPTION 'رقم الصك والأثاث يعدّلهما المالك فقط' USING ERRCODE = '42501';
  END IF;
  IF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent
     AND NOT private.agreement_permission(NEW.id, public.my_org_id(), 'pricing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل الإيجار' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (private.agreement_permission(NEW.id, public.my_org_id(), 'leasing')
              OR private.agreement_permission(NEW.id, public.my_org_id(), 'renewal_eviction')) THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل حالة الوحدة' USING ERRCODE = '42501';
  END IF;
  -- vacant_since and price_decayed_at are kept by the system (status sync, end_lease, price decay),
  -- so they never count as the office editing the unit's data.
  IF (to_jsonb(NEW) - 'annual_rent' - 'status' - 'property_id' - 'owner_id' - 'updated_at'
        - 'vacant_since' - 'price_decayed_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'annual_rent' - 'status' - 'property_id' - 'owner_id' - 'updated_at'
        - 'vacant_since' - 'price_decayed_at')
     AND NOT private.agreement_permission(NEW.id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل بيانات الوحدة' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_unit_agreement_columns() FROM PUBLIC, anon, authenticated;

-- Deleting an owner's own property. Newest body: 20261107100000 (P1); the only change is that a staff
-- account deleting its own office-less property is checked like any owner (the conditions below
-- already limit it to org_id NULL and owner_id = the caller).
CREATE OR REPLACE FUNCTION private.guard_owner_property_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR OLD.org_id IS NOT NULL
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
    WHERE u.property_id = OLD.id AND private.unit_agreement_blocks_delete(u.id)
  ) THEN
    RAISE EXCEPTION 'إحدى وحدات العقار مشمولة باتفاقية إدارة سارية أو طلب بانتظار الرد — اسحب الطلب أو أنهِ الاتفاقية أولًا'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

-- ── 3. Duplicates ────────────────────────────────────────────────────────────────────────────────
-- Same rules as src/lib/unit-duplicates.ts.
CREATE OR REPLACE FUNCTION private.deed_norm(_deed text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT NULLIF(regexp_replace(
    translate(coalesce(_deed, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '[^0-9]', '', 'g'), '')
$$;

CREATE OR REPLACE FUNCTION private.unit_number_norm(_number text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT lower(regexp_replace(regexp_replace(
    translate(coalesce(_number, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
    '\s+', ' ', 'g'), '^ | $', '', 'g'))
$$;

-- Plain (non-unique) indexes: they speed up the checks and cannot fail on existing data.
CREATE INDEX IF NOT EXISTS units_deed_norm_idx ON public.units (private.deed_norm(deed_number));
CREATE INDEX IF NOT EXISTS units_property_number_norm_idx
  ON public.units (property_id, private.unit_number_norm(unit_number));
CREATE INDEX IF NOT EXISTS properties_deed_norm_idx ON public.properties (private.deed_norm(deed_number));

-- A unit deed may repeat inside one property (one deed covering a villa's two floors), never across
-- properties: that is the same unit registered twice (by its owner and by an office, say).
CREATE OR REPLACE FUNCTION private.guard_unit_duplicates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE num text := private.unit_number_norm(NEW.unit_number);
        deed text := private.deed_norm(NEW.deed_number);
BEGIN
  IF TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id
     OR num IS DISTINCT FROM private.unit_number_norm(OLD.unit_number) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('unit_number:' || NEW.property_id || ':' || num, 0));
    IF EXISTS (
      SELECT 1 FROM public.units u
      WHERE u.property_id = NEW.property_id AND u.id <> NEW.id
        AND private.unit_number_norm(u.unit_number) = num
    ) THEN
      RAISE EXCEPTION 'رقم الوحدة «%» مسجّل بالفعل في هذا العقار', btrim(NEW.unit_number)
        USING ERRCODE = '23505';
    END IF;
  END IF;

  IF NULLIF(btrim(NEW.deed_number), '') IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.deed_number IS DISTINCT FROM OLD.deed_number)
     AND (deed IS NULL OR NEW.deed_number !~ '^[0-9٠-٩۰-۹[:space:]/-]+$') THEN
    RAISE EXCEPTION 'رقم الصك أرقام فقط' USING ERRCODE = '22023';
  END IF;

  IF deed IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.property_id IS DISTINCT FROM OLD.property_id
          OR deed IS DISTINCT FROM private.deed_norm(OLD.deed_number)) THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('unit_deed:' || deed, 0));
    IF EXISTS (
      SELECT 1 FROM public.units u
      WHERE private.deed_norm(u.deed_number) = deed
        AND u.id <> NEW.id AND u.property_id <> NEW.property_id
    ) THEN
      RAISE EXCEPTION 'رقم صك الوحدة مسجّل لوحدة في عقار آخر على جارك — تأكد من الرقم، ولا تسجّل الوحدة مرتين'
        USING ERRCODE = '23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_unit_duplicates() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a3_guard_unit_duplicates ON public.units;
CREATE TRIGGER a3_guard_unit_duplicates BEFORE INSERT OR UPDATE OF unit_number, deed_number, property_id
  ON public.units FOR EACH ROW EXECUTE FUNCTION private.guard_unit_duplicates();

CREATE OR REPLACE FUNCTION private.guard_property_deed_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE deed text := private.deed_norm(NEW.deed_number);
BEGIN
  IF NULLIF(btrim(NEW.deed_number), '') IS NULL
     OR (TG_OP = 'UPDATE' AND NEW.deed_number IS NOT DISTINCT FROM OLD.deed_number) THEN
    RETURN NEW;
  END IF;
  IF deed IS NULL OR NEW.deed_number !~ '^[0-9٠-٩۰-۹[:space:]/-]+$' THEN
    RAISE EXCEPTION 'رقم الصك أرقام فقط' USING ERRCODE = '22023';
  END IF;
  IF TG_OP = 'UPDATE' AND deed IS NOT DISTINCT FROM private.deed_norm(OLD.deed_number) THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('property_deed:' || deed, 0));
  IF EXISTS (
    SELECT 1 FROM public.properties p WHERE private.deed_norm(p.deed_number) = deed AND p.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'رقم الصك مسجّل لعقار آخر على جارك — تأكد من الرقم، ولا تسجّل العقار مرتين'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_property_deed_duplicate() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a3_guard_property_deed ON public.properties;
CREATE TRIGGER a3_guard_property_deed BEFORE INSERT OR UPDATE OF deed_number
  ON public.properties FOR EACH ROW EXECUTE FUNCTION private.guard_property_deed_duplicate();

-- The dialogs warn before saving: 'other_property' (the save will be refused), 'same_property' (a unit
-- deed already on another unit of this property — allowed), or NULL. Says only whether the deed is
-- taken, never by whom.
CREATE OR REPLACE FUNCTION public.deed_number_in_use(
  _kind text, _deed text, _property_id uuid DEFAULT NULL, _unit_id uuid DEFAULT NULL
) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL OR private.deed_norm(_deed) IS NULL THEN NULL
    WHEN _kind = 'property' THEN
      CASE WHEN EXISTS (
        SELECT 1 FROM public.properties p
        WHERE private.deed_norm(p.deed_number) = private.deed_norm(_deed)
          AND p.id IS DISTINCT FROM _property_id
      ) THEN 'other_property' END
    WHEN EXISTS (
      SELECT 1 FROM public.units u
      WHERE private.deed_norm(u.deed_number) = private.deed_norm(_deed)
        AND u.id IS DISTINCT FROM _unit_id AND u.property_id IS DISTINCT FROM _property_id
    ) THEN 'other_property'
    WHEN EXISTS (
      SELECT 1 FROM public.units u
      WHERE private.deed_norm(u.deed_number) = private.deed_norm(_deed)
        AND u.id IS DISTINCT FROM _unit_id AND u.property_id = _property_id
    ) THEN 'same_property'
  END
$$;
REVOKE ALL ON FUNCTION public.deed_number_in_use(text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deed_number_in_use(text, text, uuid, uuid) TO authenticated;

-- ── 4. Who manages a unit, and what that office may edit ─────────────────────────────────────────
-- The unit's office is its property's office, else the office of its live agreement (decision 2).
-- `registered` = the office registered the property itself. pricing/leasing are the agreement's
-- grants (always false for a registered unit: the office has full rights there). Rows only for units
-- the caller owns or for units of the caller's own office.
CREATE OR REPLACE FUNCTION public.unit_management(_unit_ids uuid[])
RETURNS TABLE (
  unit_id uuid, office_id uuid, office_name text, registered boolean, pricing boolean, leasing boolean
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, x.office, o.company_name, p.org_id IS NOT NULL,
    p.org_id IS NULL AND x.office IS NOT NULL AND private.agreement_permission(u.id, x.office, 'pricing'),
    p.org_id IS NULL AND x.office IS NOT NULL AND private.agreement_permission(u.id, x.office, 'leasing')
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  CROSS JOIN LATERAL (SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id)) AS office) x
  LEFT JOIN public.org_settings o ON o.id = x.office
  WHERE u.id = ANY(_unit_ids)
    AND auth.uid() IS NOT NULL
    AND (COALESCE(u.owner_id, p.owner_id) = auth.uid()
         OR EXISTS (
           SELECT 1 FROM public.org_members m
           WHERE m.org_id = x.office AND m.user_id = auth.uid() AND m.kind = 'member'
         ))
$$;
REVOKE ALL ON FUNCTION public.unit_management(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unit_management(uuid[]) TO authenticated;
