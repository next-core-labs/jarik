-- Review fixes (2026-11-13) for 20261111110000 / 20261111120000 / 20261111100000 / 20261109100000.
--
-- 1. Reference-code guessing: a wrong code used to RAISE, which rolled back check_rate_limit's
--    counter with it — misses were never counted, so the 6-digit space could be walked for free.
--    Now a miss returns nothing (the counter commits), and only a platform-VERIFIED office may look
--    up or link by code (any signed-up user can register an office; only the platform verifies).
-- 2. tenant_for_account_code checks the caller is a member of the office it links to.
-- 3. A team member of any office is never linked as another office's client by code (they would get
--    two org_members rows, and private.my_org() picks one of them).
-- 4. lookup_account_by_code writes (rate limit): VOLATILE, not STABLE.
-- 5. create_lease with an unknown code returns NULL without writing (so the miss is still counted).
-- 6. vacant_units_public: an owner's unit under an agreement shows only while the agreement still
--    grants `leasing` — free office listings no longer expire, so a withdrawn permission must hide it.
-- 7. Multi-year leases may be paid monthly: installments up to the term (max 60), not 24.
-- Replay-safe (CREATE OR REPLACE).

-- ── 1. Preview by code ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.lookup_account_by_code(_code text)
RETURNS TABLE (full_name text, phone_hint text, already_client boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.my_org(); p record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR v_org IS NULL THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_settings o WHERE o.id = v_org AND o.verified) THEN
    RAISE EXCEPTION 'الإضافة بالرقم التعريفي تتاح بعد اعتماد مكتبك من إدارة جارك' USING ERRCODE = '42501';
  END IF;
  -- Counted before the lookup, and committed: a miss below returns no row instead of raising.
  PERFORM public.check_rate_limit('lookup-account-by-code', 30, 3600);
  SELECT pr.id, pr.full_name, pr.phone INTO p
  FROM public.profiles pr WHERE pr.reference_code = btrim(_code);
  IF p.id IS NULL THEN RETURN; END IF;
  RETURN QUERY SELECT
    COALESCE(NULLIF(btrim(p.full_name), ''), 'بدون اسم'),
    CASE WHEN p.phone IS NULL OR length(p.phone) < 4 THEN NULL
         ELSE '••••' || right(p.phone, 4) END,
    EXISTS (SELECT 1 FROM public.org_clients c
            WHERE c.org_id = v_org AND c.user_id = p.id AND c.accepted_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.lookup_account_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_account_by_code(text) TO authenticated;

-- ── 2. Shared checks for linking by code (NULL = unknown code, nothing written) ────────────────
CREATE OR REPLACE FUNCTION private.account_for_code(_code text, _org uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR _org IS NULL
     OR NOT EXISTS (SELECT 1 FROM public.org_members m
                    WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.kind = 'member') THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_settings o WHERE o.id = _org AND o.verified) THEN
    RAISE EXCEPTION 'الإضافة بالرقم التعريفي تتاح بعد اعتماد مكتبك من إدارة جارك' USING ERRCODE = '42501';
  END IF;
  PERFORM public.check_rate_limit('lookup-account-by-code', 30, 3600);
  SELECT pr.id INTO v_id FROM public.profiles pr WHERE pr.reference_code = btrim(_code);
  IF v_id IS NULL THEN RETURN NULL; END IF;
  IF v_id = auth.uid() THEN
    RAISE EXCEPTION 'هذا رقمك التعريفي أنت' USING ERRCODE = '22023';
  END IF;
  IF public.has_role(v_id, 'super_admin')
     OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.user_id = v_id AND m.kind = 'member') THEN
    RAISE EXCEPTION 'هذا الحساب من فريق مكتب — لا يُضاف عميلًا' USING ERRCODE = '42501';
  END IF;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION private.account_for_code(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.account_for_code(text, uuid) TO authenticated;

-- ── 3. The office's tenant record for that account (NULL for an unknown code) ──────────────────
CREATE OR REPLACE FUNCTION private.tenant_for_account_code(_code text, _org uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; p record; v_email text; v_tenant uuid; v_office text;
BEGIN
  v_uid := private.account_for_code(_code, _org);
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT pr.full_name, pr.phone, pr.national_id INTO p FROM public.profiles pr WHERE pr.id = v_uid;

  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (_org, v_uid, 'client', 'tenant', false)
  ON CONFLICT (org_id, user_id) DO NOTHING;
  INSERT INTO public.org_clients (org_id, user_id, accepted_at)
  VALUES (_org, v_uid, now())
  ON CONFLICT (org_id, user_id) DO UPDATE SET accepted_at = COALESCE(org_clients.accepted_at, now());

  SELECT t.id INTO v_tenant FROM public.tenants t
  WHERE t.org_id = _org AND t.user_id = v_uid ORDER BY t.created_at LIMIT 1;
  IF v_tenant IS NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    INSERT INTO public.tenants (full_name, phone, national_id, email, org_id, user_id)
    VALUES (COALESCE(NULLIF(btrim(p.full_name), ''), 'مستأجر'), p.phone, p.national_id, v_email, _org, v_uid)
    RETURNING id INTO v_tenant;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, 'tenant') ON CONFLICT DO NOTHING;
  SELECT o.company_name INTO v_office FROM public.org_settings o WHERE o.id = _org;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source)
  VALUES (
    v_uid, _org,
    'أضافك ' || COALESCE('مكتب «' || NULLIF(btrim(v_office), '') || '»', 'مكتبك العقاري') || ' مستأجرًا',
    'عقدك ودفعاتك وطلبات الصيانة تجدها الآن في لوحة المستأجر.',
    'lease', 'system'
  );
  RETURN v_tenant;
END $$;
REVOKE ALL ON FUNCTION private.tenant_for_account_code(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.tenant_for_account_code(text, uuid) TO authenticated;

-- ── 4. «الملاك والمستأجرون» add by code (NULL for an unknown code) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.office_add_client_by_code(_code text, _kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.my_org(); v_uid uuid; p record; v_email text; v_office text;
BEGIN
  IF _kind NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'نوع غير صالح' USING ERRCODE = '22023';
  END IF;
  v_uid := private.account_for_code(_code, v_org);
  IF v_uid IS NULL THEN RETURN NULL; END IF;
  SELECT pr.full_name, pr.phone, pr.national_id INTO p FROM public.profiles pr WHERE pr.id = v_uid;

  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (v_org, v_uid, 'client', _kind, false)
  ON CONFLICT (org_id, user_id) DO NOTHING;
  INSERT INTO public.org_clients (org_id, user_id, accepted_at)
  VALUES (v_org, v_uid, now())
  ON CONFLICT (org_id, user_id) DO UPDATE SET accepted_at = COALESCE(org_clients.accepted_at, now());
  INSERT INTO public.user_roles (user_id, role) VALUES (v_uid, _kind::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  IF _kind = 'tenant' AND NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.org_id = v_org AND t.user_id = v_uid
  ) THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = v_uid;
    INSERT INTO public.tenants (full_name, phone, national_id, email, org_id, user_id)
    VALUES (COALESCE(NULLIF(btrim(p.full_name), ''), 'مستأجر'), p.phone, p.national_id, v_email, v_org, v_uid);
  END IF;

  SELECT o.company_name INTO v_office FROM public.org_settings o WHERE o.id = v_org;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source)
  VALUES (
    v_uid, v_org,
    'أضافك ' || COALESCE('مكتب «' || NULLIF(btrim(v_office), '') || '»', 'مكتب عقاري')
      || CASE WHEN _kind = 'owner' THEN ' مالكًا' ELSE ' مستأجرًا' END,
    CASE WHEN _kind = 'owner'
      THEN 'يستطيع المكتب الآن إسناد وحداتك إليك، وتتابعها من لوحة المالك.'
      ELSE 'عقودك ودفعاتك لدى هذا المكتب تظهر في لوحة المستأجر.' END,
    'system', 'system'
  );
  RETURN COALESCE(NULLIF(btrim(p.full_name), ''), 'بدون اسم');
END $$;
REVOKE ALL ON FUNCTION public.office_add_client_by_code(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_add_client_by_code(text, text) TO authenticated;

-- ── 5. Lease terms: installments up to the term (max 60) ───────────────────────────────────────
CREATE OR REPLACE FUNCTION private.check_lease_terms(
  _start date, _term_months integer, _annual_rent numeric, _installments integer
) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _start IS NULL THEN
    RAISE EXCEPTION 'أدخل تاريخ بدء العقد' USING ERRCODE = '22023';
  END IF;
  IF _annual_rent IS NULL OR _annual_rent <= 0 OR _annual_rent <> round(_annual_rent, 2) THEN
    RAISE EXCEPTION 'أدخل إيجارًا سنويًا موجبًا بحد أقصى منزلتين عشريتين' USING ERRCODE = '22023';
  END IF;
  IF _term_months IS NULL OR _term_months < 1 OR _term_months > 60 THEN
    RAISE EXCEPTION 'مدة العقد يجب أن تكون من شهر واحد إلى 5 سنوات بالأشهر الكاملة' USING ERRCODE = '22023';
  END IF;
  IF _installments IS NULL OR _installments < 1 OR _installments > 60 THEN
    RAISE EXCEPTION 'عدد الدفعات يجب أن يكون بين 1 و60' USING ERRCODE = '22023';
  END IF;
  IF _installments > _term_months THEN
    RAISE EXCEPTION 'عدد الدفعات لا يجوز أن يتجاوز مدة العقد بالأشهر' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.check_lease_terms(date, integer, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.check_lease_terms(date, integer, numeric, integer) TO authenticated, service_role;

-- ── 6. create_lease: an unknown code returns NULL with nothing written ─────────────────────────
CREATE OR REPLACE FUNCTION public.create_lease(
  _unit_id uuid, _tenant_id uuid, _new_tenant jsonb, _start_date date, _term_months integer,
  _annual_rent numeric, _installments integer, _deposit numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_unit record;
  v_org uuid;
  v_tenant uuid := _tenant_id;
  v_lease uuid;
  v_name text := btrim(COALESCE(_new_tenant ->> 'full_name', ''));
  v_code text := btrim(COALESCE(_new_tenant ->> 'reference_code', ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  PERFORM private.check_lease_terms(_start_date, _term_months, _annual_rent, _installments);
  IF _deposit IS NULL OR _deposit < 0 OR _deposit <> round(_deposit, 2) THEN
    RAISE EXCEPTION 'أدخل مبلغ التأمين بالأرقام (0 إن لم يوجد)' USING ERRCODE = '22023';
  END IF;

  SELECT u.id, u.status, u.listing_purpose INTO v_unit FROM public.units u WHERE u.id = _unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد الوحدة' USING ERRCODE = '02000';
  END IF;
  IF v_unit.status = 'sold' THEN
    RAISE EXCEPTION 'الوحدة مباعة ولا تقبل عقد إيجار' USING ERRCODE = '22023';
  END IF;
  IF NOT private.staff_can_on_unit(_unit_id, 'leasing') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تأجير هذه الوحدة' USING ERRCODE = '42501';
  END IF;
  v_org := private.org_of_unit(_unit_id);

  IF v_tenant IS NULL AND v_code <> '' THEN
    v_tenant := private.tenant_for_account_code(v_code, v_org);
    -- Unknown code: no lease, but the attempt stays counted (a RAISE would roll the counter back).
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
  ELSIF v_tenant IS NULL THEN
    IF char_length(v_name) < 3 THEN
      RAISE EXCEPTION 'اكتب اسم المستأجر الكامل' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.tenants (full_name, phone, national_id, email, org_id)
    VALUES (
      v_name,
      NULLIF(btrim(COALESCE(_new_tenant ->> 'phone', '')), ''),
      NULLIF(btrim(COALESCE(_new_tenant ->> 'national_id', '')), ''),
      NULLIF(btrim(COALESCE(_new_tenant ->> 'email', '')), ''),
      v_org
    )
    RETURNING id INTO v_tenant;
  ELSIF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant) THEN
    RAISE EXCEPTION 'لم نجد المستأجر' USING ERRCODE = '02000';
  END IF;

  INSERT INTO public.leases (
    unit_id, tenant_id, start_date, end_date, annual_rent, term_months, installments, deposit,
    status, ejar_status
  ) VALUES (
    _unit_id, v_tenant, _start_date,
    (_start_date + make_interval(months => _term_months) - INTERVAL '1 day')::date,
    _annual_rent, _term_months, _installments, _deposit, 'active', 'pending'
  )
  RETURNING id INTO v_lease;

  INSERT INTO public.payments (lease_id, amount, due_date, status)
  SELECT v_lease, s.amount, s.due_date, 'due'
  FROM private.lease_schedule(_start_date, _term_months, _annual_rent, _installments) s;

  RETURN v_lease;
END $$;
REVOKE ALL ON FUNCTION public.create_lease(uuid, uuid, jsonb, date, integer, numeric, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lease(uuid, uuid, jsonb, date, integer, numeric, integer, numeric) TO authenticated;

-- ── 7. Public listings: an agreement unit shows only while `leasing` is still granted ──────────
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
  u.furniture,
  p.city
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = u.market_org_id
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published AND op.org_id = o.id
WHERE u.status = 'vacant' AND u.market_listed
  AND (u.market_paid_until IS NULL OR u.market_paid_until > now())
  AND u.market_org_id = COALESCE(p.org_id, private.unit_agreement_org(u.id))
  AND (p.org_id IS NOT NULL OR private.agreement_permission(u.id, u.market_org_id, 'leasing'));
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
