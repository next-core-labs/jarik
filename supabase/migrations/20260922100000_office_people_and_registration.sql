-- Office registration, office people (employees and linked clients) and platform verification.
-- All of these are SECURITY DEFINER functions with their own checks: the tables they change
-- (org_settings inserts, org_members, org_clients, user_roles) have no client write policies.

-- ---------------------------------------------------------------------------------------------
-- Register a new office. The caller becomes its manager and a staff member.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.register_office(
  _name text, _city text DEFAULT NULL, _district text DEFAULT NULL,
  _fal text DEFAULT NULL, _phone text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); org uuid;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'سجّل الدخول أولًا' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members WHERE user_id = uid) THEN
    RAISE EXCEPTION 'حسابك تابع لمكتب بالفعل' USING ERRCODE = '23505';
  END IF;
  IF length(trim(coalesce(_name, ''))) < 3 OR length(_name) > 120 THEN
    RAISE EXCEPTION 'اسم المكتب مطلوب (من 3 إلى 120 حرفًا)' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('register-office', 3, 86400) THEN
    RAISE EXCEPTION 'محاولات تسجيل كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;

  -- New offices start unverified: usable, but not shown in the public market until verified.
  INSERT INTO public.org_settings (company_name, city, district, fal_license_no, office_phone, verified, created_by)
  VALUES (trim(_name), nullif(trim(_city), ''), nullif(trim(_district), ''),
          nullif(trim(_fal), ''), nullif(trim(_phone), ''), false, uid)
  RETURNING id INTO org;

  INSERT INTO public.org_members (user_id, org_id, is_manager) VALUES (uid, org, true);
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'staff') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN org;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Manager-only helpers
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.manager_org() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid;
BEGIN
  SELECT org_id INTO org FROM public.org_members WHERE user_id = auth.uid() AND is_manager;
  IF org IS NULL THEN
    RAISE EXCEPTION 'هذه الصلاحية لمدير المكتب فقط' USING ERRCODE = '42501';
  END IF;
  RETURN org;
END $$;
REVOKE EXECUTE ON FUNCTION private.manager_org() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.manager_org() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.find_user_by_email(_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid;
BEGIN
  IF NOT public.check_rate_limit('find-user-by-email', 40, 3600) THEN
    RAISE EXCEPTION 'محاولات بحث كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  SELECT id INTO uid FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1;
  IF uid IS NULL THEN
    RAISE EXCEPTION 'لا يوجد حساب بهذا البريد — اطلب منه التسجيل في المنصة أولًا' USING ERRCODE = 'P0002';
  END IF;
  RETURN uid;
END $$;
REVOKE EXECUTE ON FUNCTION private.find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.find_user_by_email(text) TO authenticated, service_role;

-- Add (or change the role of) an employee of the manager's office.
CREATE OR REPLACE FUNCTION public.office_add_member(_email text, _role text, _manager boolean DEFAULT false)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org(); target uuid; current_org uuid;
BEGIN
  IF _role NOT IN ('staff', 'technician') THEN
    RAISE EXCEPTION 'الدور يجب أن يكون موظفًا أو فنيًا' USING ERRCODE = '22023';
  END IF;
  target := private.find_user_by_email(_email);
  SELECT org_id INTO current_org FROM public.org_members WHERE user_id = target;
  IF current_org IS NOT NULL AND current_org <> org THEN
    RAISE EXCEPTION 'هذا الحساب تابع لمكتب آخر' USING ERRCODE = '23505';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = target AND role IN ('staff', 'technician');
  INSERT INTO public.user_roles (user_id, role) VALUES (target, _role::public.app_role);
  INSERT INTO public.org_members (user_id, org_id, is_manager)
  VALUES (target, org, coalesce(_manager, false) AND _role = 'staff')
  ON CONFLICT (user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;
  RETURN target;
END $$;

-- Remove an employee from the office (they keep an ordinary account).
CREATE OR REPLACE FUNCTION public.office_remove_member(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org(); was_manager boolean;
BEGIN
  SELECT is_manager INTO was_manager FROM public.org_members WHERE user_id = _user AND org_id = org;
  IF was_manager IS NULL THEN
    RAISE EXCEPTION 'هذا الحساب ليس من موظفي مكتبك' USING ERRCODE = '22023';
  END IF;
  IF was_manager AND (SELECT count(*) FROM public.org_members WHERE org_id = org AND is_manager) <= 1 THEN
    RAISE EXCEPTION 'لا يمكن إزالة آخر مدير للمكتب' USING ERRCODE = '22023';
  END IF;
  DELETE FROM public.org_members WHERE user_id = _user AND org_id = org;
  DELETE FROM public.user_roles WHERE user_id = _user AND role IN ('staff', 'technician');
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user, 'tenant');
  END IF;
END $$;

-- Make an employee a manager (or not); an office always keeps at least one manager.
CREATE OR REPLACE FUNCTION public.office_set_manager(_user uuid, _manager boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org();
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.org_members m JOIN public.user_roles r ON r.user_id = m.user_id AND r.role = 'staff'
                 WHERE m.user_id = _user AND m.org_id = org) THEN
    RAISE EXCEPTION 'المدير يجب أن يكون من موظفي المكتب' USING ERRCODE = '22023';
  END IF;
  IF NOT _manager AND (SELECT count(*) FROM public.org_members WHERE org_id = org AND is_manager AND user_id <> _user) = 0 THEN
    RAISE EXCEPTION 'لا يمكن إزالة آخر مدير للمكتب' USING ERRCODE = '22023';
  END IF;
  UPDATE public.org_members SET is_manager = _manager WHERE user_id = _user AND org_id = org;
END $$;

-- Link an existing account as an owner or tenant client of the manager's office.
CREATE OR REPLACE FUNCTION public.office_link_client(_email text, _kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org(); target uuid;
BEGIN
  IF _kind NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'النوع يجب أن يكون مالكًا أو مستأجرًا' USING ERRCODE = '22023';
  END IF;
  target := private.find_user_by_email(_email);
  INSERT INTO public.org_clients (org_id, user_id) VALUES (org, target) ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (target, _kind::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN target;
END $$;

CREATE OR REPLACE FUNCTION public.office_unlink_client(_user uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org();
BEGIN
  DELETE FROM public.org_clients WHERE org_id = org AND user_id = _user;
END $$;

-- The people of my office: employees, linked clients, and owners/tenants known through the data.
CREATE OR REPLACE FUNCTION public.office_people()
RETURNS TABLE (user_id uuid, email text, full_name text, phone text, roles text[], relation text, is_manager boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.my_org();
BEGIN
  IF org IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه الشاشة لموظفي المكتب' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH ids AS (
    SELECT m.user_id AS uid, 'member'::text AS rel, m.is_manager AS mgr FROM public.org_members m WHERE m.org_id = org
    UNION ALL SELECT c.user_id, 'client', false FROM public.org_clients c WHERE c.org_id = org
    UNION ALL SELECT t.user_id, 'linked', false FROM public.tenants t WHERE t.org_id = org AND t.user_id IS NOT NULL
    UNION ALL SELECT p.owner_id, 'linked', false FROM public.properties p WHERE p.org_id = org AND p.owner_id IS NOT NULL
    UNION ALL SELECT u.owner_id, 'linked', false FROM public.units u JOIN public.properties p ON p.id = u.property_id
              WHERE p.org_id = org AND u.owner_id IS NOT NULL
  ), best AS (
    SELECT i.uid,
           (array_agg(i.rel ORDER BY CASE i.rel WHEN 'member' THEN 1 WHEN 'client' THEN 2 ELSE 3 END))[1] AS rel,
           bool_or(i.mgr) AS mgr
    FROM ids i GROUP BY i.uid
  )
  SELECT b.uid, u.email::text, pr.full_name, pr.phone,
         coalesce((SELECT array_agg(r.role::text ORDER BY r.role::text) FROM public.user_roles r WHERE r.user_id = b.uid), '{}'::text[]),
         b.rel, b.mgr
  FROM best b
  JOIN auth.users u ON u.id = b.uid
  LEFT JOIN public.profiles pr ON pr.id = b.uid
  ORDER BY (b.rel = 'member') DESC, u.email;
END $$;

-- ---------------------------------------------------------------------------------------------
-- For the server (service role only): who belongs to an office, and which offices an account
-- belongs to. Used by the WhatsApp receiver (match a sender inside ONE office) and by client -> office
-- messages (notify the staff of the offices that account works with).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.org_user_ids(_org uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM public.org_members WHERE org_id = _org
  UNION SELECT user_id FROM public.org_clients WHERE org_id = _org
  UNION SELECT user_id FROM public.tenants WHERE org_id = _org AND user_id IS NOT NULL
  UNION SELECT owner_id FROM public.properties WHERE org_id = _org AND owner_id IS NOT NULL
  UNION SELECT u.owner_id FROM public.units u JOIN public.properties p ON p.id = u.property_id
        WHERE p.org_id = _org AND u.owner_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.orgs_of_user(_uid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.org_members WHERE user_id = _uid
  UNION SELECT org_id FROM public.org_clients WHERE user_id = _uid
  UNION SELECT org_id FROM public.tenants WHERE user_id = _uid
  UNION SELECT org_id FROM public.properties WHERE owner_id = _uid
  UNION SELECT p.org_id FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE u.owner_id = _uid
$$;
REVOKE EXECUTE ON FUNCTION public.org_user_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orgs_of_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_user_ids(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.orgs_of_user(uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- Platform administration (admin role only): list offices, verify them.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_list_offices()
RETURNS TABLE (id uuid, company_name text, city text, district text, fal_license_no text, office_phone text,
               verified boolean, listed_publicly boolean, created_at timestamptz,
               members integer, properties integer, units integer, manager_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'هذه الصلاحية لإدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.id, o.company_name, o.city, o.district, o.fal_license_no, o.office_phone,
         o.verified, o.listed_publicly, o.created_at,
         (SELECT count(*)::integer FROM public.org_members m WHERE m.org_id = o.id),
         (SELECT count(*)::integer FROM public.properties p WHERE p.org_id = o.id),
         (SELECT count(*)::integer FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE p.org_id = o.id),
         (SELECT au.email::text FROM public.org_members m JOIN auth.users au ON au.id = m.user_id
           WHERE m.org_id = o.id AND m.is_manager ORDER BY m.created_at LIMIT 1)
  FROM public.org_settings o
  ORDER BY o.verified, o.created_at DESC;
END $$;

CREATE OR REPLACE FUNCTION public.admin_set_office_verified(_org uuid, _verified boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'هذه الصلاحية لإدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  UPDATE public.org_settings SET verified = _verified WHERE id = _org;
END $$;

-- Execute rights: signed-in users only.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.register_office(text, text, text, text, text)',
    'public.office_add_member(text, text, boolean)',
    'public.office_remove_member(uuid)',
    'public.office_set_manager(uuid, boolean)',
    'public.office_link_client(text, text)',
    'public.office_unlink_client(uuid)',
    'public.office_people()',
    'public.admin_list_offices()',
    'public.admin_set_office_verified(uuid, boolean)']
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
