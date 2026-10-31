-- One system administrator (مدير النظام) for the whole platform, held by a single designated email.
--
-- Before: the legacy "admin" role (also labelled مدير النظام) was held by office managers, and the
-- roles_admin_manage policy let any holder insert/update/delete ANY user_roles row through the public
-- API — so any office manager could make any account (themselves included) admin or super_admin, and
-- the /users screen let them do the same from the UI across every office on the platform.
--
-- After:
--   * super_admin (shown as «مدير النظام», workspace /hq) can be held only by private.system_admin_email().
--   * The legacy admin role can no longer be held by anyone; office managers keep their office through
--     staff + org_members.is_manager, exactly like offices registered since register_office.
--   * Nobody writes user_roles directly any more: roles change only through the database's own
--     functions (signup, invitations, register_office) and the server's service role.
-- To hand the platform to another email later, change system_admin_email() in a new migration.

-- ── 1. The designated system administrator ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.system_admin_email()
RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT 'superadmin@jarak.com'::text $$;

CREATE OR REPLACE FUNCTION private.is_system_admin_account(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = _user_id AND lower(u.email) = private.system_admin_email()
  )
$$;
REVOKE ALL ON FUNCTION private.is_system_admin_account(uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Close direct writes to user_roles ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS roles_admin_manage ON public.user_roles;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.user_roles FROM anon, authenticated;
REVOKE ALL ON public.user_roles FROM anon;

-- ── 3. Legacy office admins keep running their office, without the platform-wide role ────────────
-- Their access to their own office comes from staff + an org_members manager row (is_staff,
-- is_office_manager); "admin" only ever added platform-wide reach on top.
INSERT INTO public.user_roles (user_id, role)
SELECT DISTINCT r.user_id, 'staff'::public.app_role
FROM public.user_roles r
JOIN public.org_members m ON m.user_id = r.user_id AND m.kind = 'member'
WHERE r.role = 'admin' AND NOT private.is_system_admin_account(r.user_id)
ON CONFLICT (user_id, role) DO NOTHING;

UPDATE public.org_members m SET is_manager = true
WHERE m.kind = 'member' AND NOT m.is_manager
  AND EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = m.user_id AND r.role = 'admin')
  AND NOT private.is_system_admin_account(m.user_id);

-- Then no one keeps the legacy role, and only the designated account keeps super_admin.
DELETE FROM public.user_roles WHERE role = 'admin';
DELETE FROM public.user_roles
WHERE role = 'super_admin' AND NOT private.is_system_admin_account(user_id);

INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'super_admin'::public.app_role
FROM auth.users u WHERE lower(u.email) = private.system_admin_email()
ON CONFLICT (user_id, role) DO NOTHING;

-- ── 4. The rule itself, enforced on every write (service role and definer functions included) ────
CREATE OR REPLACE FUNCTION private.guard_platform_roles()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.role = 'admin' THEN
    RAISE EXCEPTION 'دور «مدير النظام» القديم أُلغي — مدير المكتب يُدار من «فريق المكتب»'
      USING ERRCODE = '42501';
  END IF;
  IF NEW.role = 'super_admin' AND NOT private.is_system_admin_account(NEW.user_id) THEN
    RAISE EXCEPTION 'صلاحية «مدير النظام» محجوزة لحساب إدارة المنصة وحده'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a0_guard_platform_roles ON public.user_roles;
CREATE TRIGGER a0_guard_platform_roles BEFORE INSERT OR UPDATE ON public.user_roles
  FOR EACH ROW EXECUTE FUNCTION private.guard_platform_roles();

-- ── 5. Signup never hands out a platform role ────────────────────────────────────────────────────
-- The first-account-becomes-admin bootstrap is gone (the guard would refuse it anyway). The system
-- administrator's own account gets no default owner/tenant role: it is created and granted
-- super_admin deliberately (scripts/set-system-admin.mjs), never by public sign-up.
CREATE OR REPLACE FUNCTION public.assign_default_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE chosen text;
BEGIN
  IF lower(NEW.email) = private.system_admin_email() THEN
    RETURN NEW;
  END IF;

  chosen := NEW.raw_user_meta_data ->> 'account_type';
  IF chosen = 'owner' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner') ON CONFLICT DO NOTHING;
  ELSIF chosen = 'office' THEN
    NULL;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'tenant') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;

-- ── 6. The WhatsApp lock follows the platform's own permissions (as office verification does) ───
-- It required the legacy admin role, which /hq's «قفل واتساب» only passed because the old platform
-- account also held admin.
CREATE OR REPLACE FUNCTION public.guard_whatsapp_lock()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.whatsapp_locked IS DISTINCT FROM OLD.whatsapp_locked
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'super_admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'offices' = ANY(permissions)
     ) THEN
    RAISE EXCEPTION 'قفل الواتساب وتفعيله لإدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
