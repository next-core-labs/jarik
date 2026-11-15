-- «دعوة مستأجر» on an existing lease, inside Jarak: the office types the tenant's 6-digit
-- «الرقم التعريفي»; the person gets an in-app notice and the invitation waits at the top of their
-- pages (TenantInvitesBanner → completeTenantActivation) until they accept or decline. Nothing is
-- linked before they accept. The registration link (inviteTenant) stays for people with no account.
--
-- Uses private.account_for_code (20261113100000): verified office only, attempts counted (a miss
-- returns NULL instead of raising), staff of any office refused.

CREATE OR REPLACE FUNCTION public.office_invite_tenant_by_code(_lease_id uuid, _code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lease record;
  v_org uuid;
  v_uid uuid;
  v_email text;
  v_confirmed timestamptz;
  v_name text;
  v_office text;
  v_label text;
BEGIN
  SELECT l.id, l.unit_id, l.tenant_id, t.user_id AS tenant_user
  INTO v_lease
  FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.id = _lease_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد هذا العقد' USING ERRCODE = '02000';
  END IF;
  IF auth.uid() IS NULL OR NOT private.staff_can_on_unit(v_lease.unit_id, 'leasing') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذا العقد' USING ERRCODE = '42501';
  END IF;
  v_org := private.org_of_unit(v_lease.unit_id);

  -- Verified office, counted attempt, not the caller, not a team member of any office.
  v_uid := private.account_for_code(_code, v_org);
  IF v_uid IS NULL THEN RETURN NULL; END IF;

  SELECT COALESCE(NULLIF(btrim(p.full_name), ''), 'صاحب الحساب') INTO v_name
  FROM public.profiles p WHERE p.id = v_uid;
  IF v_lease.tenant_user = v_uid THEN
    RETURN v_name;  -- already this person's lease
  END IF;
  IF v_lease.tenant_user IS NOT NULL THEN
    RAISE EXCEPTION 'مستأجر هذا العقد مرتبط بحساب آخر' USING ERRCODE = '23505';
  END IF;

  SELECT u.email, u.email_confirmed_at INTO v_email, v_confirmed FROM auth.users u WHERE u.id = v_uid;
  IF v_email IS NULL OR v_confirmed IS NULL THEN
    RAISE EXCEPTION 'لم يؤكد صاحب هذا الحساب بريده بعد — أرسل له رابط التسجيل بدلًا من ذلك'
      USING ERRCODE = '22023';
  END IF;

  -- The invitation itself (accepted from the in-app banner). One pending per lease and account.
  IF NOT EXISTS (
    SELECT 1 FROM public.tenant_invites i
    WHERE i.lease_id = _lease_id AND i.email = lower(btrim(v_email)) AND i.used_at IS NULL
  ) THEN
    INSERT INTO public.tenant_invites (lease_id, org_id, email, created_by)
    VALUES (_lease_id, v_org, lower(btrim(v_email)), auth.uid());
  END IF;

  SELECT o.company_name INTO v_office FROM public.org_settings o WHERE o.id = v_org;
  SELECT concat_ws(' · ', pr.name, COALESCE(NULLIF(u.unit_name, ''), 'وحدة ' || u.unit_number))
  INTO v_label FROM public.units u JOIN public.properties pr ON pr.id = u.property_id
  WHERE u.id = v_lease.unit_id;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  VALUES (
    v_uid, v_org,
    'دعوة عقد إيجار من ' || COALESCE('مكتب «' || NULLIF(btrim(v_office), '') || '»', 'مكتب عقاري'),
    'يدعوك المكتب مستأجرًا على: ' || COALESCE(v_label, 'عقد إيجار')
      || '. اقبل الدعوة من أعلى أي صفحة في جارك ليظهر عقدك ودفعاتك.',
    'lease', 'system', 'leases', _lease_id
  );
  RETURN v_name;
END $$;
REVOKE ALL ON FUNCTION public.office_invite_tenant_by_code(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_invite_tenant_by_code(uuid, text) TO authenticated;
