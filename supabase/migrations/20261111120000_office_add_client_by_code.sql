-- «الملاك والمستأجرون» (formerly «صفحات الملاك»): the office adds an owner or a tenant by the
-- person's 6-digit «الرقم التعريفي». Product decision 2026-11-11: giving the number to the office is
-- the person's consent — they are linked right away and notified (no acceptance step). By email it
-- stays an invitation the person accepts (office_link_client, unchanged).
--
-- Uses lookup_account_by_code's rate limit bucket (20261111110000) so the two together cannot be
-- used to scan codes. Replay-safe.

CREATE OR REPLACE FUNCTION public.office_add_client_by_code(_code text, _kind text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid := public.my_org();
  p record;
  v_email text;
  v_office text;
  v_member_kind text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) OR v_org IS NULL THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  IF _kind NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'نوع غير صالح' USING ERRCODE = '22023';
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
    RAISE EXCEPTION 'هذا رقمك التعريفي أنت' USING ERRCODE = '22023';
  END IF;
  IF public.has_role(p.id, 'super_admin') THEN
    RAISE EXCEPTION 'لا يمكن إضافة هذا الحساب' USING ERRCODE = '42501';
  END IF;
  SELECT m.kind INTO v_member_kind FROM public.org_members m WHERE m.org_id = v_org AND m.user_id = p.id;
  IF v_member_kind = 'member' THEN
    RAISE EXCEPTION 'هذا الحساب من فريق مكتبك' USING ERRCODE = '22023';
  END IF;

  -- The office's client, listed with its people (office_people), and allowed on its records.
  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (v_org, p.id, 'client', _kind, false)
  ON CONFLICT (org_id, user_id) DO NOTHING;
  INSERT INTO public.org_clients (org_id, user_id, accepted_at)
  VALUES (v_org, p.id, now())
  ON CONFLICT (org_id, user_id) DO UPDATE SET accepted_at = COALESCE(org_clients.accepted_at, now());
  INSERT INTO public.user_roles (user_id, role) VALUES (p.id, _kind::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  -- A tenant gets the office's tenant record now, so «مستأجر مسجّل» offers them on a new lease.
  IF _kind = 'tenant' AND NOT EXISTS (
    SELECT 1 FROM public.tenants t WHERE t.org_id = v_org AND t.user_id = p.id
  ) THEN
    SELECT u.email INTO v_email FROM auth.users u WHERE u.id = p.id;
    INSERT INTO public.tenants (full_name, phone, national_id, email, org_id, user_id)
    VALUES (COALESCE(NULLIF(btrim(p.full_name), ''), 'مستأجر'), p.phone, p.national_id, v_email, v_org, p.id);
  END IF;

  SELECT o.company_name INTO v_office FROM public.org_settings o WHERE o.id = v_org;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source)
  VALUES (
    p.id, v_org,
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
