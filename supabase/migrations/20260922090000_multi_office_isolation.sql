-- Multi-office: every office sees and manages ONLY its own data.
--
-- Model
--   * An office is an org_settings row. `org_members` says which office an employee (admin/staff/
--     technician account) belongs to; `org_clients` links owner/tenant accounts to the offices that
--     work with them. Owners and tenants are also linked implicitly by their data (their units,
--     leases, tenant record), see private.user_in_org().
--   * Staff policies (`is_staff(auth.uid())`) are left as they are, and ONE restrictive policy per
--     table (`org_isolation`) narrows staff to the rows of their own office. Owners, tenants and
--     technicians are not staff, so they are still limited only by the policies they already had.
--   * Everything that exists today is moved to the primary (oldest) office and every current
--     staff/admin/technician becomes a member of it, so the current office keeps working unchanged.
--   * New offices start unverified: they can use the system, but their offers are not shown in the
--     public market until the platform admin verifies them.

-- ---------------------------------------------------------------------------------------------
-- 1) Membership tables and office verification
-- ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.org_members (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  is_manager boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS org_members_org_idx ON public.org_members (org_id);

CREATE TABLE IF NOT EXISTS public.org_clients (
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS org_clients_user_idx ON public.org_clients (user_id);

ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
-- The office that exists today was set up by the platform owner.
UPDATE public.org_settings SET verified = true;

-- ---------------------------------------------------------------------------------------------
-- 1b) org_id on every table whose rows do not hang off a property/unit/lease. Added first because
--     the SQL helpers below reference these columns and PostgreSQL validates SQL functions on creation.
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.owner_pages ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- 2) Helpers (SECURITY DEFINER so they read across RLS without recursion)
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.primary_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.org_settings ORDER BY created_at, id LIMIT 1
$$;

CREATE OR REPLACE FUNCTION private.my_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid()
$$;

CREATE OR REPLACE FUNCTION private.is_org_member(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.org_members WHERE user_id = auth.uid() AND org_id = _org)
$$;

/** true for owners/tenants/technicians (not office staff); office staff must belong to `_org`. */
CREATE OR REPLACE FUNCTION private.staff_scope_ok(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_staff(auth.uid())
      OR EXISTS (SELECT 1 FROM public.org_members WHERE user_id = auth.uid() AND org_id = _org)
$$;

CREATE OR REPLACE FUNCTION private.org_of_property(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.properties WHERE id = _id
$$;
CREATE OR REPLACE FUNCTION private.org_of_unit(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.org_id FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE u.id = _id
$$;
CREATE OR REPLACE FUNCTION private.org_of_lease(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.org_id FROM public.leases l JOIN public.units u ON u.id = l.unit_id
  JOIN public.properties p ON p.id = u.property_id WHERE l.id = _id
$$;

CREATE OR REPLACE FUNCTION private.try_uuid(_t text) RETURNS uuid
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN RETURN _t::uuid; EXCEPTION WHEN others THEN RETURN NULL; END $$;

/** Is this account connected to the office (employee, linked client, or through its data)? */
CREATE OR REPLACE FUNCTION private.user_in_org(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _org IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.org_clients WHERE user_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.properties WHERE owner_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
               WHERE u.owner_id = _uid AND p.org_id = _org)
    OR EXISTS (SELECT 1 FROM public.tenants WHERE user_id = _uid AND org_id = _org)
  )
$$;

-- ---------------------------------------------------------------------------------------------
-- 3) Backfill and constraints for the org_id columns added in section 1b
-- ---------------------------------------------------------------------------------------------
-- properties.org_id and unit_requests.org_id already exist; deleting an office now deletes its data.
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_org_id_fkey;
ALTER TABLE public.properties
  ADD CONSTRAINT properties_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.unit_requests DROP CONSTRAINT IF EXISTS unit_requests_org_id_fkey;
ALTER TABLE public.unit_requests
  ADD CONSTRAINT unit_requests_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.org_settings(id) ON DELETE CASCADE;

-- Backfill: everything that exists today belongs to the primary office (or to the office of the
-- property/unit/lease it hangs off, which is the same thing for now). The row triggers are switched
-- off while doing it: this is a data move, not a user edit, so it must not write "UPDATE" entries
-- to the audit log or bump every row's updated_at.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','tenants','invoices','expenses','deals','owner_pages',
                           'whatsapp_channels','whatsapp_messages','maintenance_requests','unit_requests','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE TRIGGER USER', t);
  END LOOP;
END $$;

UPDATE public.properties SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.tenants SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.invoices i SET org_id = COALESCE(private.org_of_lease(i.lease_id), private.primary_org()) WHERE org_id IS NULL;
UPDATE public.expenses e SET org_id = COALESCE(private.org_of_property(e.property_id), private.org_of_unit(e.unit_id), private.primary_org()) WHERE org_id IS NULL;
UPDATE public.deals d SET org_id = COALESCE(private.org_of_property(d.property_id), private.primary_org()) WHERE org_id IS NULL;
UPDATE public.owner_pages SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.whatsapp_channels SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.whatsapp_messages m SET org_id = COALESCE(
  (SELECT c.org_id FROM public.whatsapp_channels c WHERE c.id = m.channel_id), private.primary_org()) WHERE org_id IS NULL;
UPDATE public.maintenance_requests r SET org_id = COALESCE(
  private.org_of_unit(r.unit_id), (SELECT t.org_id FROM public.tenants t WHERE t.id = r.tenant_id), private.primary_org()) WHERE org_id IS NULL;
UPDATE public.unit_requests SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.audit_log SET org_id = private.primary_org() WHERE org_id IS NULL;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','tenants','invoices','expenses','deals','owner_pages',
                           'whatsapp_channels','whatsapp_messages','maintenance_requests','unit_requests','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE TRIGGER USER', t);
  END LOOP;
END $$;

-- Every current employee belongs to the primary office; admins manage it.
INSERT INTO public.org_members (user_id, org_id, is_manager)
SELECT r.user_id, private.primary_org(), bool_or(r.role = 'admin')
FROM public.user_roles r
WHERE r.role IN ('admin', 'staff', 'technician') AND private.primary_org() IS NOT NULL
GROUP BY r.user_id
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.properties ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.tenants ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.invoices ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.expenses ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.deals ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.owner_pages ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.whatsapp_channels ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.whatsapp_messages ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.maintenance_requests ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE public.unit_requests ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS tenants_org_idx ON public.tenants (org_id);
CREATE INDEX IF NOT EXISTS invoices_org_idx ON public.invoices (org_id);
CREATE INDEX IF NOT EXISTS expenses_org_idx ON public.expenses (org_id);
CREATE INDEX IF NOT EXISTS deals_org_idx ON public.deals (org_id);
CREATE INDEX IF NOT EXISTS whatsapp_channels_org_idx ON public.whatsapp_channels (org_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_org_idx ON public.whatsapp_messages (org_id);
CREATE INDEX IF NOT EXISTS maintenance_requests_org_idx ON public.maintenance_requests (org_id);
CREATE INDEX IF NOT EXISTS unit_requests_org_idx ON public.unit_requests (org_id);
CREATE INDEX IF NOT EXISTS audit_log_org_idx ON public.audit_log (org_id);

/** New rows get the office of what they hang off, else the creator's office, else the primary one. */
CREATE OR REPLACE FUNCTION private.fill_org_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jsonb := to_jsonb(NEW); o uuid;
BEGIN
  IF NEW.org_id IS NOT NULL THEN RETURN NEW; END IF;
  o := CASE TG_TABLE_NAME
    WHEN 'deals' THEN private.org_of_property(private.try_uuid(j->>'property_id'))
    WHEN 'expenses' THEN COALESCE(private.org_of_property(private.try_uuid(j->>'property_id')),
                                  private.org_of_unit(private.try_uuid(j->>'unit_id')))
    WHEN 'invoices' THEN private.org_of_lease(private.try_uuid(j->>'lease_id'))
    WHEN 'maintenance_requests' THEN COALESCE(private.org_of_unit(private.try_uuid(j->>'unit_id')),
      (SELECT t.org_id FROM public.tenants t WHERE t.id = private.try_uuid(j->>'tenant_id')))
    WHEN 'whatsapp_messages' THEN (SELECT c.org_id FROM public.whatsapp_channels c WHERE c.id = private.try_uuid(j->>'channel_id'))
    ELSE NULL END;
  NEW.org_id := COALESCE(o, private.my_org(), private.primary_org());
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.fill_org_id() FROM PUBLIC;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['properties','tenants','invoices','expenses','deals','owner_pages',
                           'whatsapp_channels','whatsapp_messages','maintenance_requests','unit_requests']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS a_fill_org ON public.%I', t);
    EXECUTE format('CREATE TRIGGER a_fill_org BEFORE INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION private.fill_org_id()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 4) Isolation: one restrictive policy per table
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('properties',           'org_id',                                             'org_id'),
    ('tenants',              'org_id',                                             'org_id'),
    ('invoices',             'org_id',                                             'org_id'),
    ('expenses',             'org_id',                                             'org_id'),
    ('deals',                'org_id',                                             'org_id'),
    ('owner_pages',          'org_id',                                             'org_id'),
    ('whatsapp_channels',    'org_id',                                             'org_id'),
    ('whatsapp_messages',    'org_id',                                             'org_id'),
    ('maintenance_requests', 'org_id',                                             'org_id'),
    ('unit_requests',        'org_id',                                             'org_id'),
    ('audit_log',            'org_id',                                             'org_id'),
    ('units',                'private.org_of_property(property_id)',               'private.org_of_property(property_id)'),
    ('leases',               'private.org_of_unit(unit_id)',                       'private.org_of_unit(unit_id)'),
    ('payments',             'private.org_of_lease(lease_id)',                     'private.org_of_lease(lease_id)'),
    ('renewal_requests',     'private.org_of_lease(lease_id)',                     'private.org_of_lease(lease_id)'),
    ('meter_readings',       'private.org_of_unit(unit_id)',                       'private.org_of_unit(unit_id)'),
    ('repair_invoices',      'private.org_of_unit(unit_id)',                       'private.org_of_unit(unit_id)'),
    ('unit_events',          'private.org_of_unit(unit_id)',                       'private.org_of_unit(unit_id)'),
    ('unit_messages',        'private.org_of_unit(unit_id)',                       'private.org_of_unit(unit_id)'),
    ('unit_photos',          'private.org_of_unit(unit_id)',                       'private.org_of_unit(unit_id)'),
    ('property_documents',   'private.org_of_property(property_id)',               'private.org_of_property(property_id)')
  ) AS v(tbl, using_expr, check_expr)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', spec.tbl);
    EXECUTE format(
      'CREATE POLICY org_isolation ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (private.staff_scope_ok(%s)) WITH CHECK (private.staff_scope_ok(%s))',
      spec.tbl, spec.using_expr, spec.check_expr);
  END LOOP;
END $$;

-- Tables where staff could read other people's rows: keep the same shape, but only people of the office.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR (public.is_staff(auth.uid()) AND private.user_in_org(id, private.my_org())));

DROP POLICY IF EXISTS roles_select ON public.user_roles;
CREATE POLICY roles_select ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND private.user_in_org(user_id, private.my_org())));

DROP POLICY IF EXISTS notifications_read ON public.notifications;
CREATE POLICY notifications_read ON public.notifications FOR SELECT TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND private.user_in_org(user_id, private.my_org())));
DROP POLICY IF EXISTS notifications_update ON public.notifications;
CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND private.user_in_org(user_id, private.my_org())))
WITH CHECK (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND private.user_in_org(user_id, private.my_org())));
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
CREATE POLICY notifications_insert ON public.notifications FOR INSERT TO authenticated
WITH CHECK (public.is_staff(auth.uid()) AND private.user_in_org(user_id, private.my_org()));
DROP POLICY IF EXISTS notifications_delete ON public.notifications;
CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO authenticated
USING (user_id = auth.uid() OR (public.is_staff(auth.uid()) AND private.user_in_org(user_id, private.my_org())));

-- Offices: an account can read the settings (branding, VAT number...) of the offices it belongs to or
-- works with, and only staff of an office can edit it. Creating an office goes through
-- register_office() (next migration); there is no INSERT policy for clients.
DROP POLICY IF EXISTS org_read ON public.org_settings;
CREATE POLICY org_read ON public.org_settings FOR SELECT TO authenticated
USING (private.user_in_org(auth.uid(), id));
DROP POLICY IF EXISTS org_write ON public.org_settings;
CREATE POLICY org_write ON public.org_settings FOR ALL TO authenticated
USING (public.is_staff(auth.uid()) AND private.is_org_member(id))
WITH CHECK (public.is_staff(auth.uid()) AND private.is_org_member(id));

ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_members_read ON public.org_members FOR SELECT TO authenticated
USING (user_id = auth.uid() OR org_id = private.my_org());
GRANT SELECT ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;

ALTER TABLE public.org_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_clients_read ON public.org_clients FOR SELECT TO authenticated
USING (user_id = auth.uid() OR org_id = private.my_org());
GRANT SELECT ON public.org_clients TO authenticated;
GRANT ALL ON public.org_clients TO service_role;

-- `verified` is decided by the platform, never by the office itself.
CREATE OR REPLACE FUNCTION public.guard_org_verified() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.verified IS DISTINCT FROM OLD.verified
     AND auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'اعتماد المكتب من إدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS org_settings_guard_verified ON public.org_settings;
CREATE TRIGGER org_settings_guard_verified BEFORE UPDATE ON public.org_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_org_verified();
REVOKE EXECUTE ON FUNCTION public.guard_org_verified() FROM PUBLIC, anon, authenticated;

-- Execute rights for the helpers the policies call.
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'private.primary_org()', 'private.my_org()', 'private.is_org_member(uuid)', 'private.staff_scope_ok(uuid)',
    'private.org_of_property(uuid)', 'private.org_of_unit(uuid)', 'private.org_of_lease(uuid)',
    'private.try_uuid(text)', 'private.user_in_org(uuid, uuid)']
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;

-- The client asks for its own office; the server (service role) asks for the office of any row.
CREATE OR REPLACE FUNCTION public.my_org_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ SELECT private.my_org() $$;
REVOKE EXECUTE ON FUNCTION public.my_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_org_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.org_of(_table text, _id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN CASE _table
    WHEN 'properties' THEN private.org_of_property(_id)
    WHEN 'units' THEN private.org_of_unit(_id)
    WHEN 'leases' THEN private.org_of_lease(_id)
    WHEN 'payments' THEN (SELECT private.org_of_lease(p.lease_id) FROM public.payments p WHERE p.id = _id)
    WHEN 'tenants' THEN (SELECT org_id FROM public.tenants WHERE id = _id)
    WHEN 'maintenance_requests' THEN (SELECT org_id FROM public.maintenance_requests WHERE id = _id)
    WHEN 'unit_requests' THEN (SELECT org_id FROM public.unit_requests WHERE id = _id)
    WHEN 'whatsapp_channels' THEN (SELECT org_id FROM public.whatsapp_channels WHERE id = _id)
    ELSE NULL END;
END $$;
REVOKE EXECUTE ON FUNCTION public.org_of(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_of(text, uuid) TO service_role;

-- ---------------------------------------------------------------------------------------------
-- 5) SECURITY DEFINER functions that used to look at everything
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notify_unit_staff(_unit_id uuid, _title text, _body text, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) OR NOT private.staff_scope_ok(private.org_of_unit(_unit_id)) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM public.notify_unit(_unit_id, _title, _body, _kind);
END $$;

CREATE OR REPLACE FUNCTION public.tenant_overdue_count(_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT (
    (public.is_staff(auth.uid())
       AND private.is_org_member((SELECT t.org_id FROM public.tenants t WHERE t.id = _tenant_id)))
    OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT count(*)::integer INTO n
  FROM public.payments p JOIN public.leases l ON l.id = p.lease_id
  WHERE l.tenant_id = _tenant_id AND p.status <> 'paid' AND p.due_date < current_date;
  RETURN n;
END $$;

-- Reminders: a staff member (or the button) reminds only the tenants of their own office; the daily
-- cron job (no user) still covers every office.
CREATE OR REPLACE FUNCTION public.smart_payment_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c int := 0; d int; already boolean; r record;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT pay.id, pay.amount, pay.due_date, t.user_id, u.unit_number, pr.name AS property_name
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    JOIN public.tenants t ON t.id = l.tenant_id
    LEFT JOIN public.units u ON u.id = l.unit_id
    LEFT JOIN public.properties pr ON pr.id = u.property_id
    WHERE pay.status <> 'paid' AND t.user_id IS NOT NULL
      AND pay.due_date <= (current_date + 7)
      AND (auth.uid() IS NULL OR pr.org_id = private.my_org())
  LOOP
    d := r.due_date - current_date;
    IF d NOT IN (7,3,0) OR d < 0 THEN CONTINUE; END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = r.user_id AND n.kind = 'payment_reminder'
        AND n.related_id = r.id AND n.created_at::date = current_date
    ) INTO already;
    IF already THEN CONTINUE; END IF;
    INSERT INTO public.notifications(user_id, title, body, kind, source, related_table, related_id)
    VALUES (
      r.user_id,
      CASE WHEN d = 0 THEN 'دفعتك مستحقة اليوم' ELSE 'تذكير قبل استحقاق دفعتك' END,
      CASE WHEN d = 0
        THEN CONCAT('دفعة ', COALESCE(r.property_name,''), ' - وحدة ', COALESCE(r.unit_number,'-'), ' بمبلغ ', ROUND(r.amount)::text, ' ريال مستحقة اليوم — رصيدك المتبقي ', ROUND(r.amount)::text, ' ريال.')
        ELSE CONCAT('دفعة ', COALESCE(r.property_name,''), ' - وحدة ', COALESCE(r.unit_number,'-'), ' بمبلغ ', ROUND(r.amount)::text, ' ريال تستحق بعد ', d::text, ' يوم — رصيدك المتبقي ', ROUND(r.amount)::text, ' ريال.')
      END,
      'payment_reminder', 'auto', 'payments', r.id
    );
    c := c + 1;
  END LOOP;
  RETURN c;
END $$;

CREATE OR REPLACE FUNCTION public.notify_expiring_leases(_days integer DEFAULT 60) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT l.unit_id, l.end_date, u.unit_number
    FROM public.leases l JOIN public.units u ON u.id = l.unit_id
    WHERE l.status = 'active'
      AND l.end_date BETWEEN current_date AND current_date + _days
      AND private.org_of_unit(l.unit_id) = private.my_org()
  LOOP
    PERFORM public.notify_unit(r.unit_id,
      'عقد الوحدة ' || r.unit_number || ' ينتهي قريبًا',
      'تاريخ انتهاء العقد: ' || r.end_date::text, 'lease');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- The audit log records the office of the row that changed.
CREATE OR REPLACE FUNCTION public.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; j jsonb := to_jsonb(COALESCE(NEW, OLD)); o uuid;
BEGIN
  rid := COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(OLD)->>'id')::uuid);
  o := CASE TG_TABLE_NAME
    WHEN 'units' THEN private.org_of_property(private.try_uuid(j->>'property_id'))
    WHEN 'leases' THEN private.org_of_unit(private.try_uuid(j->>'unit_id'))
    WHEN 'payments' THEN private.org_of_lease(private.try_uuid(j->>'lease_id'))
    ELSE private.try_uuid(j->>'org_id') END;
  INSERT INTO public.audit_log(actor_id, table_name, row_id, action, summary, org_id)
  VALUES (auth.uid(), TG_TABLE_NAME, rid, TG_OP, j, COALESCE(o, private.my_org(), private.primary_org()));
  RETURN COALESCE(NEW, OLD);
END $$;

-- Invoice numbers are per office (a seller's own sequence).
CREATE TABLE IF NOT EXISTS public.invoice_counters (
  org_id uuid PRIMARY KEY REFERENCES public.org_settings(id) ON DELETE CASCADE,
  last_number bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counters FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.invoice_counters TO service_role;
INSERT INTO public.invoice_counters (org_id, last_number)
SELECT private.primary_org(), COALESCE((SELECT last_number FROM public.invoice_counter LIMIT 1), 0)
WHERE private.primary_org() IS NOT NULL
ON CONFLICT (org_id) DO NOTHING;
-- offices that already have invoices but no counter row yet (safety): start above their highest number
INSERT INTO public.invoice_counters (org_id, last_number)
SELECT i.org_id, GREATEST(count(*), COALESCE(max((regexp_match(i.invoice_number, '(\d+)$'))[1]::bigint), 0))
FROM public.invoices i GROUP BY i.org_id
ON CONFLICT (org_id) DO NOTHING;
DROP TABLE IF EXISTS public.invoice_counter;

CREATE OR REPLACE FUNCTION public.next_invoice_number(_year integer DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint; org uuid := private.my_org();
BEGIN
  IF auth.uid() IS NOT NULL AND (NOT public.is_staff(auth.uid()) OR org IS NULL) THEN
    RAISE EXCEPTION 'إصدار الفواتير لموظفي مكتب فقط' USING ERRCODE = '42501';
  END IF;
  org := COALESCE(org, private.primary_org());
  INSERT INTO public.invoice_counters (org_id, last_number) VALUES (org, 1)
  ON CONFLICT (org_id) DO UPDATE SET last_number = public.invoice_counters.last_number + 1
  RETURNING last_number INTO n;
  RETURN 'INV-' || COALESCE(_year, EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Riyadh')::integer)
         || '-' || lpad(n::text, 4, '0');
END $$;

DROP INDEX IF EXISTS public.invoices_invoice_number_key;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices GROUP BY org_id, invoice_number HAVING count(*) > 1) THEN
    RAISE NOTICE 'invoices already contain duplicate numbers inside one office: unique index NOT created.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_org_number_key ON public.invoices (org_id, invoice_number);
  END IF;
END $$;

-- ---------------------------------------------------------------------------------------------
-- 6) Storage: writes stay inside the office's own folders
-- ---------------------------------------------------------------------------------------------
/** The office a listing-media object belongs to, from its path (<unit>/.., owners/<owner>/.., offices/<office>/..). */
CREATE OR REPLACE FUNCTION private.media_folder_org(_name text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f1 text := (storage.foldername(_name))[1]; f2 text := (storage.foldername(_name))[2];
BEGIN
  IF f1 = 'owners' THEN
    RETURN CASE WHEN private.user_in_org(private.try_uuid(f2), private.my_org()) THEN private.my_org() ELSE NULL END;
  ELSIF f1 = 'offices' THEN
    RETURN private.try_uuid(f2);
  END IF;
  RETURN private.org_of_unit(private.try_uuid(f1));
END $$;
REVOKE EXECUTE ON FUNCTION private.media_folder_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.media_folder_org(text) TO authenticated, service_role;

DROP POLICY IF EXISTS listing_media_insert ON storage.objects;
DROP POLICY IF EXISTS listing_media_update ON storage.objects;
DROP POLICY IF EXISTS listing_media_delete ON storage.objects;
CREATE POLICY listing_media_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'listing-media' AND public.is_staff(auth.uid())
  AND private.media_folder_org(name) = private.my_org());
CREATE POLICY listing_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'listing-media' AND public.is_staff(auth.uid()) AND private.media_folder_org(name) = private.my_org())
WITH CHECK (bucket_id = 'listing-media' AND public.is_staff(auth.uid()) AND private.media_folder_org(name) = private.my_org());
CREATE POLICY listing_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'listing-media' AND public.is_staff(auth.uid()) AND private.media_folder_org(name) = private.my_org());

-- Property documents: <property id>/<file>
DROP POLICY IF EXISTS documents_insert ON storage.objects;
DROP POLICY IF EXISTS documents_update ON storage.objects;
DROP POLICY IF EXISTS documents_delete ON storage.objects;
DROP POLICY IF EXISTS documents_read ON storage.objects;
CREATE POLICY documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'documents' AND public.is_staff(auth.uid())
  AND private.org_of_property(private.try_uuid((storage.foldername(name))[1])) = private.my_org());
CREATE POLICY documents_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'documents' AND public.is_staff(auth.uid())
  AND private.org_of_property(private.try_uuid((storage.foldername(name))[1])) = private.my_org())
WITH CHECK (bucket_id = 'documents' AND public.is_staff(auth.uid())
  AND private.org_of_property(private.try_uuid((storage.foldername(name))[1])) = private.my_org());
CREATE POLICY documents_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'documents' AND public.is_staff(auth.uid())
  AND private.org_of_property(private.try_uuid((storage.foldername(name))[1])) = private.my_org());
CREATE POLICY documents_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'documents' AND (
  (public.is_staff(auth.uid())
    AND private.org_of_property(private.try_uuid((storage.foldername(name))[1])) = private.my_org())
  OR EXISTS (SELECT 1 FROM public.property_documents d JOIN public.properties p ON p.id = d.property_id
             WHERE d.file_path = objects.name AND p.owner_id = auth.uid())));

-- Logos: <office id>/<file> from now on (existing files at the bucket root stay readable, and nobody
-- can overwrite them from the app).
DROP POLICY IF EXISTS branding_insert_staff ON storage.objects;
DROP POLICY IF EXISTS branding_update_staff ON storage.objects;
DROP POLICY IF EXISTS branding_delete_staff ON storage.objects;
CREATE POLICY branding_insert_staff ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'branding' AND public.is_staff(auth.uid())
  AND private.try_uuid((storage.foldername(name))[1]) = private.my_org());
CREATE POLICY branding_update_staff ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'branding' AND public.is_staff(auth.uid())
  AND private.try_uuid((storage.foldername(name))[1]) = private.my_org())
WITH CHECK (bucket_id = 'branding' AND public.is_staff(auth.uid())
  AND private.try_uuid((storage.foldername(name))[1]) = private.my_org());
CREATE POLICY branding_delete_staff ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'branding' AND public.is_staff(auth.uid())
  AND private.try_uuid((storage.foldername(name))[1]) = private.my_org());

-- Maintenance photos/voice notes: staff can read those of accounts connected to their office.
DROP POLICY IF EXISTS maintenance_media_read ON storage.objects;
CREATE POLICY maintenance_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'maintenance-media' AND (
  auth.uid()::text = (storage.foldername(name))[1]
  OR (public.is_staff(auth.uid())
      AND private.user_in_org(private.try_uuid((storage.foldername(name))[1]), private.my_org()))));

-- ---------------------------------------------------------------------------------------------
-- 7) Public views: only verified, publicly listed offices; a unit belongs to its property's office
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street,
       u.floor_no, u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.furnished,
       o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
       o.city AS office_city, o.district AS office_district,
       u.listing_description, u.amenities, u.created_at,
       (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id
         ORDER BY ph.position, ph.created_at LIMIT 1) AS cover_path,
       (SELECT count(*)::integer FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
       o.id AS office_id,
       op.owner_id AS owner_page_id,
       op.display_name AS owner_name,
       op.avatar_path AS owner_avatar_path,
       COALESCE(NULLIF(op.phone, ''), o.office_phone) AS contact_phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), o.whatsapp_number, o.office_phone) AS contact_whatsapp
FROM public.units u
JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.id = p.org_id AND o.listed_publicly AND o.verified
LEFT JOIN public.owner_pages op
  ON op.published AND op.org_id = o.id AND op.owner_id = COALESCE(u.owner_id, p.owner_id)
WHERE u.status = 'vacant';

CREATE OR REPLACE VIEW public.office_pages_public AS
SELECT o.id, o.company_name, o.logo_url, o.banner_path, o.bio, o.fal_license_no,
       o.office_phone, o.whatsapp_number, o.city, o.district,
       (SELECT count(*)::integer FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o
WHERE o.listed_publicly AND o.verified;

CREATE OR REPLACE VIEW public.office_directory AS
SELECT id, company_name, office_code, fal_license_no, office_phone, city, district, logo_url
FROM public.org_settings
WHERE listed_publicly AND verified;

CREATE OR REPLACE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.avatar_path,
       COALESCE(NULLIF(op.phone, ''), o.office_phone) AS phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), o.whatsapp_number, o.office_phone) AS whatsapp,
       (SELECT count(*)::integer FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op
JOIN public.org_settings o ON o.id = op.org_id AND o.listed_publicly AND o.verified
WHERE op.published;
