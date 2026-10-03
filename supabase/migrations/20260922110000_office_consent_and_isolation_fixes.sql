-- =============================================================================================
-- Multi-office, round 2: close the holes found while auditing 20260922090000 / 20260922100000.
--
-- The first two migrations isolated each office's *rows*. They still trusted two things they
-- should not have: (a) that a uuid an office writes into owner_id / user_id really is that
-- office's client, and (b) that a client-supplied org_id agrees with the row's parent. Both are
-- writable by any office, so any office could reach another office's people and rows.
--
-- What changes here:
--   1. Joining an office needs the account's consent (an invitation it accepts).
--   2. owner_id / user_id may only name people of that office, enforced by triggers.
--   3. org_id is always derived from the parent row, never taken from the client.
--   4. notifications are owned by an office, and staff only ever see their own office's.
--   5. Storage, public views, market stats and the admin surface are scoped to match.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1) Invitations: an office asks, the account accepts. Nothing links without acceptance.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  -- Stored as an email, not a uuid: an invitation must not tell the office whether the
  -- address is registered (that turned the old RPCs into an account-existence oracle).
  email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('member', 'client')),
  role text NOT NULL CHECK (role IN ('staff', 'technician', 'owner', 'tenant')),
  is_manager boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  answered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS org_invitations_pending_key
  ON public.org_invitations (org_id, lower(email), kind) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS org_invitations_email_idx ON public.org_invitations (lower(email)) WHERE status = 'pending';

/** The signed-in account's email. A policy cannot read auth.users directly, and the JWT claim is
    not available in every execution context, so it goes through one definer function. */
CREATE OR REPLACE FUNCTION private.my_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(email) FROM auth.users WHERE id = auth.uid()
$$;
REVOKE EXECUTE ON FUNCTION private.my_email() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.my_email() TO authenticated, service_role;

ALTER TABLE public.org_invitations ENABLE ROW LEVEL SECURITY;
-- Read-only through RLS; every write goes through the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS org_invitations_read ON public.org_invitations;
CREATE POLICY org_invitations_read ON public.org_invitations FOR SELECT TO authenticated
USING (org_id = private.my_org() OR lower(email) = private.my_email());
GRANT SELECT ON public.org_invitations TO authenticated;
GRANT ALL ON public.org_invitations TO service_role;

-- org_clients rows now record *how* the link was made. Only accepted links grant access.
ALTER TABLE public.org_clients ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
-- Everything linked before this migration was linked by the office without asking. The office
-- exists and its data is real, so these stay valid; only new links need acceptance.
UPDATE public.org_clients SET accepted_at = now() WHERE accepted_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- 2) A person is "of an office" only through membership or an accepted client link.
--    Implicit links (owner_id / user_id) stay, but section 3 stops them being forged.
-- ---------------------------------------------------------------------------------------------
/** May this office name this account on one of its rows (owner of a property, tenant, ...)? */
CREATE OR REPLACE FUNCTION private.may_link(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NULL OR _org IS NULL
      OR EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _uid AND org_id = _org)
      OR EXISTS (SELECT 1 FROM public.org_clients WHERE user_id = _uid AND org_id = _org AND accepted_at IS NOT NULL)
$$;
REVOKE EXECUTE ON FUNCTION private.may_link(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.may_link(uuid, uuid) TO authenticated, service_role;

/** Backfill: every account an office already points at counts as an accepted client of it, so
    the triggers below do not reject updates to rows that predate this migration. */
INSERT INTO public.org_clients (org_id, user_id, accepted_at)
SELECT DISTINCT org_id, owner_id, now() FROM public.properties WHERE owner_id IS NOT NULL AND org_id IS NOT NULL
UNION
SELECT DISTINCT p.org_id, u.owner_id, now() FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.owner_id IS NOT NULL AND p.org_id IS NOT NULL
UNION
SELECT DISTINCT org_id, user_id, now() FROM public.tenants WHERE user_id IS NOT NULL AND org_id IS NOT NULL
ON CONFLICT DO NOTHING;

/** Refuse a row that names someone who is not of this office. The office must invite them first. */
CREATE OR REPLACE FUNCTION private.guard_person_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jsonb := to_jsonb(NEW); uid uuid; org uuid;
BEGIN
  uid := private.try_uuid(j ->> CASE TG_TABLE_NAME WHEN 'tenants' THEN 'user_id' ELSE 'owner_id' END);
  IF uid IS NULL THEN RETURN NEW; END IF;
  org := CASE TG_TABLE_NAME
    WHEN 'units' THEN private.org_of_property(private.try_uuid(j ->> 'property_id'))
    ELSE private.try_uuid(j ->> 'org_id') END;
  IF NOT private.may_link(uid, org) THEN
    RAISE EXCEPTION 'هذا الحساب ليس من أشخاص مكتبك — ادعُه أولًا من شاشة «فريق المكتب»'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_person_link() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties', 'units', 'tenants'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS b_guard_person ON public.%I', t);
    EXECUTE format('CREATE TRIGGER b_guard_person BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.guard_person_link()', t);
  END LOOP;
END $$;

/** A maintenance job may only be assigned to a technician of the same office. */
CREATE OR REPLACE FUNCTION private.guard_technician() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.technician_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_members m
                     WHERE m.user_id = NEW.technician_id AND m.org_id = NEW.org_id) THEN
    RAISE EXCEPTION 'الفني ليس من فريق هذا المكتب' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_technician() FROM PUBLIC;
DROP TRIGGER IF EXISTS c_guard_technician ON public.maintenance_requests;
DROP TRIGGER IF EXISTS z_guard_technician ON public.maintenance_requests;
-- `z_` so it fires after maintenance_guard_columns: that trigger blanks the privileged fields a
-- tenant may not set (technician_id among them), and it must do so before this one judges them.
CREATE TRIGGER z_guard_technician BEFORE INSERT OR UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_technician();

-- ---------------------------------------------------------------------------------------------
-- 3) org_id is derived, never supplied: a staff member cannot post a row into another office,
--    nor point one of their own rows at another office's parent row.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.fill_org_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jsonb := to_jsonb(NEW); o uuid;
BEGIN
  o := CASE TG_TABLE_NAME
    WHEN 'deals' THEN private.org_of_property(private.try_uuid(j->>'property_id'))
    WHEN 'expenses' THEN COALESCE(private.org_of_property(private.try_uuid(j->>'property_id')),
                                  private.org_of_unit(private.try_uuid(j->>'unit_id')))
    WHEN 'invoices' THEN private.org_of_lease(private.try_uuid(j->>'lease_id'))
    WHEN 'maintenance_requests' THEN COALESCE(private.org_of_unit(private.try_uuid(j->>'unit_id')),
      (SELECT t.org_id FROM public.tenants t WHERE t.id = private.try_uuid(j->>'tenant_id')))
    WHEN 'whatsapp_messages' THEN (SELECT c.org_id FROM public.whatsapp_channels c WHERE c.id = private.try_uuid(j->>'channel_id'))
    WHEN 'notifications' THEN NULL
    ELSE NULL END;

  -- The parent decides. Only a row with no parent may keep what it was given, and even then a
  -- staff member is held to their own office.
  IF o IS NOT NULL THEN
    NEW.org_id := o;
  ELSE
    NEW.org_id := COALESCE(
      CASE WHEN public.is_staff(auth.uid()) THEN private.my_org() ELSE NULL END,
      NEW.org_id, private.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','tenants','invoices','expenses','deals','owner_pages',
                           'whatsapp_channels','whatsapp_messages','maintenance_requests','unit_requests']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_fill_org ON public.%I', t);
    -- Also on UPDATE: moving a row to another office by rewriting org_id is not a thing.
    EXECUTE format('CREATE TRIGGER a_fill_org BEFORE INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.fill_org_id()', t);
  END LOOP;
END $$;

/** Cross-office references: every id a row points at must live in the same office. */
CREATE OR REPLACE FUNCTION private.guard_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- `ref` rather than `id`: a variable called `id` is ambiguous against the column in `t.id = id`.
DECLARE j jsonb := to_jsonb(NEW); bad boolean := false; ref uuid;
BEGIN
  ref := private.try_uuid(j->>'unit_id');
  IF ref IS NOT NULL AND private.org_of_unit(ref) IS DISTINCT FROM NEW.org_id THEN bad := true; END IF;
  ref := private.try_uuid(j->>'property_id');
  IF ref IS NOT NULL AND private.org_of_property(ref) IS DISTINCT FROM NEW.org_id THEN bad := true; END IF;
  ref := private.try_uuid(j->>'lease_id');
  IF ref IS NOT NULL AND private.org_of_lease(ref) IS DISTINCT FROM NEW.org_id THEN bad := true; END IF;
  ref := private.try_uuid(j->>'tenant_id');
  IF ref IS NOT NULL
     AND (SELECT t.org_id FROM public.tenants t WHERE t.id = ref) IS DISTINCT FROM NEW.org_id THEN bad := true; END IF;
  IF bad THEN
    RAISE EXCEPTION 'لا يمكن ربط بيانات مكتب آخر بهذا السجل' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_same_org() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['invoices','expenses','deals','maintenance_requests'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS d_guard_same_org ON public.%I', t);
    EXECUTE format('CREATE TRIGGER d_guard_same_org AFTER INSERT OR UPDATE ON public.%I
                    FOR EACH ROW EXECUTE FUNCTION private.guard_same_org()', t);
  END LOOP;
END $$;

-- org_settings.created_at decides which office is the primary one; it must not be editable.
CREATE OR REPLACE FUNCTION private.guard_org_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;
  NEW.created_by := OLD.created_by;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_org_immutable() FROM PUBLIC;
DROP TRIGGER IF EXISTS e_guard_org_immutable ON public.org_settings;
CREATE TRIGGER e_guard_org_immutable BEFORE UPDATE ON public.org_settings
FOR EACH ROW EXECUTE FUNCTION private.guard_org_immutable();

-- ---------------------------------------------------------------------------------------------
-- 4) Notifications belong to an office. Staff read their own office's, never a person's whole inbox.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS notifications_org_idx ON public.notifications (org_id);
UPDATE public.notifications SET org_id = private.primary_org() WHERE org_id IS NULL;

DROP POLICY IF EXISTS notifications_read ON public.notifications;
CREATE POLICY notifications_read ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND org_id = private.my_org()));
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND org_id = private.my_org()))
WITH CHECK (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND org_id = private.my_org()));
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated
WITH CHECK (public.is_staff(auth.uid()) AND org_id = private.my_org()
            AND private.user_in_org(user_id, private.my_org()));
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND org_id = private.my_org()));

-- A notification written from the browser carries the writer's office.
DROP TRIGGER IF EXISTS a_fill_org ON public.notifications;
CREATE TRIGGER a_fill_org BEFORE INSERT ON public.notifications
FOR EACH ROW WHEN (NEW.org_id IS NULL) EXECUTE FUNCTION private.fill_org_id();

-- Profiles and roles: only people actually of the office (membership or an accepted link).
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR (public.is_staff(auth.uid()) AND private.may_link(id, private.my_org())));

DROP POLICY IF EXISTS roles_select ON public.user_roles;
CREATE POLICY roles_select ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND private.may_link(user_id, private.my_org())));

-- ---------------------------------------------------------------------------------------------
-- 5) The office people RPCs, now consent-based.
-- ---------------------------------------------------------------------------------------------
/** Rate limit that survives the failure path (the old one rolled its own counter back). */
CREATE OR REPLACE FUNCTION private.find_user_by_email(_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.check_rate_limit('find-user-by-email', 40, 3600) THEN
    RAISE EXCEPTION 'محاولات بحث كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  -- No exception for "not found": the caller must not learn whether an address is registered.
  RETURN (SELECT id FROM auth.users WHERE lower(email) = lower(trim(_email)) LIMIT 1);
END $$;

-- These three change their return type (they no longer hand back the target's uuid, which was an
-- account-existence oracle), and market_stats/admin_list_offices change shape, so they are dropped
-- first: CREATE OR REPLACE cannot change a function's signature.
DROP FUNCTION IF EXISTS public.office_add_member(text, text, boolean);
DROP FUNCTION IF EXISTS public.office_link_client(text, text);
DROP FUNCTION IF EXISTS public.market_stats();
DROP FUNCTION IF EXISTS public.admin_list_offices();

/** Invite an employee. Nothing happens to the account until it accepts. */
CREATE OR REPLACE FUNCTION public.office_add_member(_email text, _role text, _manager boolean DEFAULT false)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org();
BEGIN
  IF _role NOT IN ('staff', 'technician') THEN
    RAISE EXCEPTION 'الدور يجب أن يكون موظفًا أو فنيًا' USING ERRCODE = '22023';
  END IF;
  IF _email IS NULL OR position('@' in _email) = 0 THEN
    RAISE EXCEPTION 'اكتب بريدًا إلكترونيًا صحيحًا' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('office-invite', 40, 3600) THEN
    RAISE EXCEPTION 'دعوات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.org_invitations (org_id, email, kind, role, is_manager, created_by)
  VALUES (org, trim(_email), 'member', _role, coalesce(_manager, false) AND _role = 'staff', auth.uid())
  ON CONFLICT DO NOTHING;
END $$;

/** Invite an owner or a tenant to be linked to the office. */
CREATE OR REPLACE FUNCTION public.office_link_client(_email text, _kind text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org();
BEGIN
  IF _kind NOT IN ('owner', 'tenant') THEN
    RAISE EXCEPTION 'النوع يجب أن يكون مالكًا أو مستأجرًا' USING ERRCODE = '22023';
  END IF;
  IF _email IS NULL OR position('@' in _email) = 0 THEN
    RAISE EXCEPTION 'اكتب بريدًا إلكترونيًا صحيحًا' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('office-invite', 40, 3600) THEN
    RAISE EXCEPTION 'دعوات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.org_invitations (org_id, email, kind, role, created_by)
  VALUES (org, trim(_email), 'client', _kind, auth.uid())
  ON CONFLICT DO NOTHING;
END $$;

/** A manager may withdraw an invitation that is still pending. */
CREATE OR REPLACE FUNCTION public.office_revoke_invitation(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.manager_org();
BEGIN
  UPDATE public.org_invitations SET status = 'revoked', answered_at = now(), answered_by = auth.uid()
  WHERE id = _id AND org_id = org AND status = 'pending';
END $$;

/** The invitations waiting for the signed-in account. */
CREATE OR REPLACE FUNCTION public.my_invitations()
RETURNS TABLE (id uuid, org_id uuid, office_name text, kind text, role text, is_manager boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.org_id, o.company_name, i.kind, i.role, i.is_manager, i.created_at
  FROM public.org_invitations i
  JOIN public.org_settings o ON o.id = i.org_id
  WHERE i.status = 'pending'
    AND lower(i.email) = private.my_email()
  ORDER BY i.created_at DESC
$$;

/** Accept an invitation: this, and only this, links the account to the office. */
CREATE OR REPLACE FUNCTION public.accept_invitation(_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; uid uuid := auth.uid(); other_org uuid;
BEGIN
  SELECT * INTO inv FROM public.org_invitations
   WHERE id = _id AND status = 'pending' AND lower(email) = private.my_email();
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الدعوة غير موجودة أو انتهت' USING ERRCODE = 'P0002';
  END IF;

  IF inv.kind = 'member' THEN
    SELECT org_id INTO other_org FROM public.org_members WHERE user_id = uid;
    IF other_org IS NOT NULL AND other_org <> inv.org_id THEN
      RAISE EXCEPTION 'حسابك تابع لمكتب آخر' USING ERRCODE = '23505';
    END IF;
    -- Office staff see their office's rows and not their own client rows elsewhere, so joining a
    -- team while being an owner or tenant of another office would hide that person's own data.
    IF EXISTS (SELECT 1 FROM public.org_clients c WHERE c.user_id = uid AND c.org_id <> inv.org_id)
       OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.user_id = uid AND t.org_id <> inv.org_id)
       OR EXISTS (SELECT 1 FROM public.properties p WHERE p.owner_id = uid AND p.org_id <> inv.org_id) THEN
      RAISE EXCEPTION 'حسابك مرتبط بمكتب آخر كمالك أو مستأجر — لا يمكن ضمه لفريق مكتب' USING ERRCODE = '23505';
    END IF;
    DELETE FROM public.user_roles WHERE user_id = uid AND role IN ('staff', 'technician');
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, inv.role::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    INSERT INTO public.org_members (user_id, org_id, is_manager) VALUES (uid, inv.org_id, inv.is_manager)
    ON CONFLICT (user_id) DO UPDATE SET is_manager = EXCLUDED.is_manager;
  ELSE
    INSERT INTO public.org_clients (org_id, user_id, accepted_at) VALUES (inv.org_id, uid, now())
    ON CONFLICT (org_id, user_id) DO UPDATE SET accepted_at = now();
    INSERT INTO public.user_roles (user_id, role) VALUES (uid, inv.role::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
  END IF;

  UPDATE public.org_invitations SET status = 'accepted', answered_at = now(), answered_by = uid WHERE id = _id;
  RETURN inv.org_id;
END $$;

CREATE OR REPLACE FUNCTION public.decline_invitation(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.org_invitations SET status = 'declined', answered_at = now(), answered_by = auth.uid()
  WHERE id = _id AND status = 'pending' AND lower(email) = private.my_email();
END $$;

/** The office's own pending invitations, for the team screen. */
CREATE OR REPLACE FUNCTION public.office_invitations()
RETURNS TABLE (id uuid, email text, kind text, role text, is_manager boolean, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := private.my_org();
BEGIN
  IF org IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه الشاشة لموظفي المكتب' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.id, i.email, i.kind, i.role, i.is_manager, i.created_at
  FROM public.org_invitations i WHERE i.org_id = org AND i.status = 'pending'
  ORDER BY i.created_at DESC;
END $$;

/** Removing an employee also hands back the jobs they were holding. */
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
  -- Otherwise the technician branch of the maintenance policies keeps letting them in.
  UPDATE public.maintenance_requests SET technician_id = NULL
   WHERE org_id = org AND technician_id = _user;
  DELETE FROM public.org_members WHERE user_id = _user AND org_id = org;
  DELETE FROM public.user_roles WHERE user_id = _user AND role IN ('staff', 'technician');
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user) THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_user, 'tenant');
  END IF;
END $$;

/** An account may not register an office while it is someone else's owner or tenant. */
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
  IF EXISTS (SELECT 1 FROM public.org_clients WHERE user_id = uid)
     OR EXISTS (SELECT 1 FROM public.tenants WHERE user_id = uid)
     OR EXISTS (SELECT 1 FROM public.properties WHERE owner_id = uid) THEN
    RAISE EXCEPTION 'حسابك مرتبط بمكتب آخر كمالك أو مستأجر — استخدم حسابًا آخر لتسجيل مكتبك'
      USING ERRCODE = '23505';
  END IF;
  IF length(trim(coalesce(_name, ''))) < 3 OR length(_name) > 120 THEN
    RAISE EXCEPTION 'اسم المكتب مطلوب (من 3 إلى 120 حرفًا)' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('register-office', 3, 86400) THEN
    RAISE EXCEPTION 'محاولات تسجيل كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.org_settings (company_name, city, district, fal_license_no, office_phone, verified, created_by)
  VALUES (trim(_name), nullif(trim(_city), ''), nullif(trim(_district), ''),
          nullif(trim(_fal), ''), nullif(trim(_phone), ''), false, uid)
  RETURNING id INTO org;

  INSERT INTO public.org_members (user_id, org_id, is_manager) VALUES (uid, org, true);
  INSERT INTO public.user_roles (user_id, role) VALUES (uid, 'staff') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN org;
END $$;

-- office_people() gains the pending invitations' people through office_invitations(); the accepted
-- client link is what counts here, so only the accepted_at rows are listed.
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
    UNION ALL SELECT c.user_id, 'client', false FROM public.org_clients c
              WHERE c.org_id = org AND c.accepted_at IS NOT NULL
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

-- Only accepted client links count towards "this account works with this office".
CREATE OR REPLACE FUNCTION private.user_in_org(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _org IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.org_clients WHERE user_id = _uid AND org_id = _org AND accepted_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM public.properties WHERE owner_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
               WHERE u.owner_id = _uid AND p.org_id = _org)
    OR EXISTS (SELECT 1 FROM public.tenants WHERE user_id = _uid AND org_id = _org)
  )
$$;

CREATE OR REPLACE FUNCTION public.org_user_ids(_org uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT user_id FROM public.org_members WHERE org_id = _org
  UNION SELECT user_id FROM public.org_clients WHERE org_id = _org AND accepted_at IS NOT NULL
  UNION SELECT user_id FROM public.tenants WHERE org_id = _org AND user_id IS NOT NULL
  UNION SELECT owner_id FROM public.properties WHERE org_id = _org AND owner_id IS NOT NULL
  UNION SELECT u.owner_id FROM public.units u JOIN public.properties p ON p.id = u.property_id
        WHERE p.org_id = _org AND u.owner_id IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.orgs_of_user(_uid uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.org_members WHERE user_id = _uid
  UNION SELECT org_id FROM public.org_clients WHERE user_id = _uid AND accepted_at IS NOT NULL
  UNION SELECT org_id FROM public.tenants WHERE user_id = _uid
  UNION SELECT org_id FROM public.properties WHERE owner_id = _uid
  UNION SELECT p.org_id FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE u.owner_id = _uid
$$;

-- ---------------------------------------------------------------------------------------------
-- 6) Storage: stop deriving permission from a link the office itself wrote.
-- ---------------------------------------------------------------------------------------------
/** The office of a listing-media object, from its path. An owner folder belongs to the office that
    published that owner's page — not to whoever claims the owner as a client. */
CREATE OR REPLACE FUNCTION private.media_folder_org(_name text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f1 text := (storage.foldername(_name))[1]; f2 text := (storage.foldername(_name))[2];
BEGIN
  IF _name ~ '(^|/)\.{1,2}(/|$)' OR _name LIKE '%//%' THEN RETURN NULL; END IF;
  IF f1 = 'owners' THEN
    RETURN (SELECT op.org_id FROM public.owner_pages op
             WHERE op.owner_id = private.try_uuid(f2) AND op.org_id = private.my_org() LIMIT 1);
  ELSIF f1 = 'offices' THEN
    RETURN private.try_uuid(f2);
  END IF;
  RETURN private.org_of_unit(private.try_uuid(f1));
END $$;

-- Private maintenance media: staff see a file only when one of their office's requests points at it.
DROP POLICY IF EXISTS maintenance_media_read ON storage.objects;
CREATE POLICY maintenance_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'maintenance-media' AND (
  auth.uid()::text = (storage.foldername(name))[1]
  OR (public.is_staff(auth.uid()) AND EXISTS (
        SELECT 1 FROM public.maintenance_requests m
        WHERE m.org_id = private.my_org()
          AND objects.name IN (m.photo_path, m.audio_path)))));

-- A property owner reads only the documents inside that property's own folder.
DROP POLICY IF EXISTS documents_read ON storage.objects;
CREATE POLICY documents_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'documents' AND (
  (public.is_staff(auth.uid())
    AND private.org_of_property(private.try_uuid((storage.foldername(name))[1])) = private.my_org())
  OR EXISTS (SELECT 1 FROM public.property_documents d JOIN public.properties p ON p.id = d.property_id
             WHERE d.file_path = objects.name AND p.owner_id = auth.uid()
               AND split_part(objects.name, '/', 1) = p.id::text)));

-- The read policies on `listing-media` and `branding` stay as they are. They look like a way to
-- enumerate other offices' files, but both buckets are public — every object in them is already
-- fetchable by URL without any policy — and removing SELECT breaks the app in two places: the
-- office logo is read with storage.download(), and an upload that returns the stored row needs
-- SELECT on it. What those buckets hold is listing photos and logos, which are meant to be seen.

-- Path traversal: media_folder_org now refuses '..' and empty segments outright. The document and
-- branding policies compare the first segment to a uuid, and '..' does not parse as one, so a
-- traversing name fails their check already.

-- ---------------------------------------------------------------------------------------------
-- 7) Owner pages: one page per office, not one per owner across the platform.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'owner_pages_pkey'
               AND conrelid = 'public.owner_pages'::regclass) THEN
    ALTER TABLE public.owner_pages DROP CONSTRAINT owner_pages_pkey;
  END IF;
  ALTER TABLE public.owner_pages ALTER COLUMN org_id SET NOT NULL;
  ALTER TABLE public.owner_pages ADD CONSTRAINT owner_pages_pkey PRIMARY KEY (org_id, owner_id);
EXCEPTION WHEN others THEN
  RAISE NOTICE 'owner_pages primary key unchanged: %', SQLERRM;
END $$;

-- An office may only publish a page for one of its own people.
DROP POLICY IF EXISTS owner_pages_staff_all ON public.owner_pages;
CREATE POLICY owner_pages_staff_all ON public.owner_pages FOR ALL TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()) AND private.may_link(owner_id, org_id));

-- ---------------------------------------------------------------------------------------------
-- 8) Market statistics: an office's own numbers, not the whole platform's.
-- ---------------------------------------------------------------------------------------------
-- It used to aggregate every office on the platform for anyone signed in. Now it covers only the
-- offices the caller actually belongs to: their own office for staff, and for an owner or tenant
-- the offices they work with — which is what the neighbourhood report on their page is about.
CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS TABLE(district text, units_count bigint, avg_rent numeric, occupancy_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         count(*), round(avg(u.annual_rent)),
         round(100.0 * count(*) FILTER (WHERE u.status = 'occupied') / count(*))
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  WHERE private.user_in_org(auth.uid(), p.org_id)
  GROUP BY 1 ORDER BY 1
$$;

-- ---------------------------------------------------------------------------------------------
-- 9) Platform administration: the flags only the platform may change, and the office's channels.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_office_flags(
  _org uuid, _whatsapp_locked boolean DEFAULT NULL, _listed_publicly boolean DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'هذه الصلاحية لإدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  UPDATE public.org_settings
     SET whatsapp_locked = COALESCE(_whatsapp_locked, whatsapp_locked),
         listed_publicly = COALESCE(_listed_publicly, listed_publicly)
   WHERE id = _org;
END $$;

CREATE OR REPLACE FUNCTION public.admin_list_offices()
RETURNS TABLE (id uuid, company_name text, city text, district text, fal_license_no text, office_phone text,
               verified boolean, listed_publicly boolean, whatsapp_locked boolean, created_at timestamptz,
               members integer, properties integer, units integer, manager_email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'هذه الصلاحية لإدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT o.id, o.company_name, o.city, o.district, o.fal_license_no, o.office_phone,
         o.verified, o.listed_publicly, o.whatsapp_locked, o.created_at,
         (SELECT count(*)::integer FROM public.org_members m WHERE m.org_id = o.id),
         (SELECT count(*)::integer FROM public.properties p WHERE p.org_id = o.id),
         (SELECT count(*)::integer FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE p.org_id = o.id),
         (SELECT au.email::text FROM public.org_members m JOIN auth.users au ON au.id = m.user_id
           WHERE m.org_id = o.id AND m.is_manager ORDER BY m.created_at LIMIT 1)
  FROM public.org_settings o
  ORDER BY o.verified, o.created_at DESC;
END $$;

-- A WhatsApp channel belongs to the office, not to the employee who happened to create it: when
-- that employee leaves, the office's number must not leave with them.
DROP POLICY IF EXISTS wa_channels_manage ON public.whatsapp_channels;
CREATE POLICY wa_channels_manage ON public.whatsapp_channels FOR ALL TO authenticated
USING (public.is_staff(auth.uid()) AND private.is_org_member(org_id))
WITH CHECK (public.is_staff(auth.uid()) AND private.is_org_member(org_id));
-- The phone number is unique per office, so one office cannot squat another's number.
DO $$
BEGIN
  ALTER TABLE public.whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_phone_key;
  CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_channels_org_phone_key
    ON public.whatsapp_channels (org_id, phone);
EXCEPTION WHEN others THEN RAISE NOTICE 'whatsapp_channels phone uniqueness unchanged: %', SQLERRM;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 10) Documents: the stored path must be inside the property's folder.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.property_documents
    ADD CONSTRAINT property_documents_path_in_property_folder
    CHECK (file_path IS NULL
           OR (file_path LIKE property_id::text || '/%' AND file_path NOT LIKE '%..%')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 11) Public views are read-only for clients (a single-table view is updatable by default).
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE v text;
BEGIN
  FOREACH v IN ARRAY ARRAY['office_directory','office_pages_public','vacant_units_public',
                           'vacant_unit_photos_public','owner_pages_public'] LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.%I FROM anon, authenticated', v);
  END LOOP;
EXCEPTION WHEN undefined_table THEN NULL;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 12) Execute rights for everything added or replaced here.
-- ---------------------------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.org_user_ids(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.orgs_of_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_user_ids(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.orgs_of_user(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION private.find_user_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.find_user_by_email(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.user_in_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_in_org(uuid, uuid) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.media_folder_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.media_folder_org(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION private.fill_org_id() FROM PUBLIC;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.register_office(text, text, text, text, text)',
    'public.office_add_member(text, text, boolean)',
    'public.office_link_client(text, text)',
    'public.office_remove_member(uuid)',
    'public.office_revoke_invitation(uuid)',
    'public.office_invitations()',
    'public.office_people()',
    'public.my_invitations()',
    'public.accept_invitation(uuid)',
    'public.decline_invitation(uuid)',
    'public.market_stats()',
    'public.admin_list_offices()',
    'public.admin_set_office_flags(uuid, boolean, boolean)']
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
