-- «عقد جديد»: the tenant can be an existing Jarak account, added by its 6-digit «الرقم التعريفي»
-- (profiles.reference_code, shown on the person's profile card). Product decision 2026-11-11: the
-- person giving their number to the office is their consent — they are linked right away (as the
-- office's client) and notified, no acceptance step.
--
-- create_lease is the newest definition from 20261107120000_owner_logic_leases.sql, unchanged except
-- for the new `reference_code` key of _new_tenant. Replay-safe.

-- ── 1. Preview: whose number is this? (staff only, rate-limited against scanning codes) ─────────
CREATE OR REPLACE FUNCTION public.lookup_account_by_code(_code text)
RETURNS TABLE (full_name text, phone_hint text, already_client boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid := public.my_org(); p record;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR v_org IS NULL THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('lookup-account-by-code', 30, 3600) THEN
    RAISE EXCEPTION 'محاولات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  SELECT pr.id, pr.full_name, pr.phone INTO p
  FROM public.profiles pr WHERE pr.reference_code = btrim(_code);
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد حساب بهذا الرقم التعريفي' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT
    COALESCE(NULLIF(btrim(p.full_name), ''), 'بدون اسم'),
    -- Only the last digits, enough to confirm it is the right person.
    CASE WHEN p.phone IS NULL OR length(p.phone) < 4 THEN NULL
         ELSE '••••' || right(p.phone, 4) END,
    EXISTS (SELECT 1 FROM public.org_clients c
            WHERE c.org_id = v_org AND c.user_id = p.id AND c.accepted_at IS NOT NULL);
END $$;
REVOKE ALL ON FUNCTION public.lookup_account_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lookup_account_by_code(text) TO authenticated;

-- ── 2. The office's tenant record for that account (created and linked if needed) ──────────────
CREATE OR REPLACE FUNCTION private.tenant_for_account_code(_code text, _org uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record; v_email text; v_tenant uuid; v_office text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR _org IS NULL THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  IF NOT public.check_rate_limit('lookup-account-by-code', 30, 3600) THEN
    RAISE EXCEPTION 'محاولات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  SELECT pr.id, pr.full_name, pr.phone, pr.national_id INTO p
  FROM public.profiles pr WHERE pr.reference_code = btrim(_code);
  IF p.id IS NULL THEN
    RAISE EXCEPTION 'لا يوجد حساب بهذا الرقم التعريفي' USING ERRCODE = '22023';
  END IF;
  IF p.id = auth.uid() THEN
    RAISE EXCEPTION 'هذا رقمك التعريفي أنت — أدخل رقم المستأجر' USING ERRCODE = '22023';
  END IF;
  IF public.has_role(p.id, 'super_admin') THEN
    RAISE EXCEPTION 'لا يمكن إضافة هذا الحساب مستأجرًا' USING ERRCODE = '42501';
  END IF;

  -- Linked right away: the account becomes this office's client — in org_members (what
  -- office_people lists, as an accepted email invitation does) and org_clients (private.may_link).
  -- A team member keeps their membership (ON CONFLICT DO NOTHING).
  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (_org, p.id, 'client', 'tenant', false)
  ON CONFLICT (org_id, user_id) DO NOTHING;
  INSERT INTO public.org_clients (org_id, user_id, accepted_at)
  VALUES (_org, p.id, now())
  ON CONFLICT (org_id, user_id) DO UPDATE SET accepted_at = COALESCE(org_clients.accepted_at, now());

  -- Reuse the office's tenant record for this account if it has one.
  SELECT t.id INTO v_tenant FROM public.tenants t
  WHERE t.org_id = _org AND t.user_id = p.id
  ORDER BY t.created_at LIMIT 1;

  IF v_tenant IS NULL THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p.id;
    INSERT INTO public.tenants (full_name, phone, national_id, email, org_id, user_id)
    VALUES (
      COALESCE(NULLIF(btrim(p.full_name), ''), 'مستأجر'),
      p.phone, p.national_id, v_email, _org, p.id
    )
    RETURNING id INTO v_tenant;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (p.id, 'tenant') ON CONFLICT DO NOTHING;

  SELECT o.company_name INTO v_office FROM public.org_settings o WHERE o.id = _org;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source)
  VALUES (
    p.id, _org,
    'أضافك ' || COALESCE('مكتب «' || NULLIF(btrim(v_office), '') || '»', 'مكتبك العقاري') || ' مستأجرًا',
    'عقدك ودفعاتك وطلبات الصيانة تجدها الآن في لوحة المستأجر.',
    'lease', 'system'
  );
  RETURN v_tenant;
END $$;
REVOKE ALL ON FUNCTION private.tenant_for_account_code(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.tenant_for_account_code(text, uuid) TO authenticated;

-- ── 3. create_lease: _new_tenant may carry {"reference_code": "123456"} ─────────────────────────
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
