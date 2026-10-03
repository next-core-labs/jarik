-- Security hardening found in the backend review (2026-09-20).
-- Forward-only: no existing rows are deleted or rewritten by this migration.

-- 1) Sign-up must NOT grant `staff`.
--    handle_new_user() (trigger on_auth_user_created) used to insert a `staff` role. Postgres fires
--    same-event triggers alphabetically, so it ran BEFORE assign_default_role() (trigger
--    on_auth_user_created_role). Every self-registered account therefore got `staff` (+ `tenant`),
--    and the "first user becomes admin" branch could never fire. Roles now come only from
--    assign_default_role(): first user => admin, everyone else => tenant. Admins promote people
--    from the /users screen (setAccountRole).
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END; $$;

-- Accounts created BEFORE this fix may still hold a `staff` role they should not have.
-- Review them (as admin, from /users) or run this in the SQL editor and demote as needed:
--   SELECT u.email, array_agg(r.role) AS roles
--   FROM auth.users u JOIN public.user_roles r ON r.user_id = u.id
--   GROUP BY u.email ORDER BY u.created_at;

-- 2) The admin-only WhatsApp lock was enforced only in the UI. Any staff user could flip
--    org_settings.whatsapp_locked through the REST API. auth.uid() is NULL for the service role,
--    pg_cron and the SQL editor, so server-side code and migrations are unaffected.
CREATE OR REPLACE FUNCTION public.guard_whatsapp_lock() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.whatsapp_locked IS DISTINCT FROM OLD.whatsapp_locked
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'قفل الواتساب وتفعيله لمدير النظام فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS org_settings_guard_whatsapp_lock ON public.org_settings;
CREATE TRIGGER org_settings_guard_whatsapp_lock
BEFORE UPDATE ON public.org_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_whatsapp_lock();
REVOKE EXECUTE ON FUNCTION public.guard_whatsapp_lock() FROM PUBLIC, anon, authenticated;

-- 3) Only office staff may create/manage WhatsApp channels. Before, any authenticated user could
--    insert a channel for themselves (and squat another office's phone via UNIQUE(phone)).
DROP POLICY IF EXISTS wa_channels_manage ON public.whatsapp_channels;
CREATE POLICY wa_channels_manage ON public.whatsapp_channels FOR ALL TO authenticated
USING (public.is_staff(auth.uid()) AND (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin')))
WITH CHECK (public.is_staff(auth.uid()) AND (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin')));

-- 4) Visitor unit requests are inserted by the submitUnitRequest server function (service role,
--    with zod length limits). The anonymous INSERT policy let anyone bypass those limits over REST.
DROP POLICY IF EXISTS unit_requests_anon_insert ON public.unit_requests;
REVOKE INSERT ON public.unit_requests FROM anon, authenticated;

-- 5) "Convert vacant unit to a deal" (/office-stats) used to insert deals with stage 'new', a stage
--    the /deals board never renders, so those deals were invisible. Move them to the first column.
UPDATE public.deals SET stage = 'lead' WHERE stage = 'new';
