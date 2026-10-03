-- =============================================================================================
-- CRITICAL: the office system (org_members / org_settings.verified / register_office / ...)
-- currently built in this database lets any signed-in account register a second office and then
-- read, edit and delete every OTHER office's properties, units, leases, tenants, payments and
-- invoices — because the only access rule on those tables is "is this account staff at all"
-- (public.is_staff(auth.uid())), with no per-office scoping whatsoever. Reproduced directly
-- against this database's live shape before writing this fix: a freshly registered office could
-- SELECT, UPDATE and DELETE another office's rows outright.
--
-- This migration adds ONE additional RESTRICTIVE policy per business table: staff access is
-- additionally required to belong (via org_members, kind='member') to the SAME office as the row.
-- It changes nothing about how owners or tenants already see their own data (those permissive
-- policies are untouched) — it only closes the staff-to-staff cross-office hole.
--
-- Today there is exactly one office with real data, so every existing row is backfilled to that
-- one office and nothing observable changes for it.
-- =============================================================================================

-- ---------------------------------------------------------------------------------------------
-- 1) org_id columns where none exist yet: properties (root of the ownership chain) and deals
--    (may have no property yet, e.g. a lead not tied to a listing).
-- ---------------------------------------------------------------------------------------------
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS properties_org_id_idx ON public.properties (org_id);

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS deals_org_id_idx ON public.deals (org_id);

-- The office that existed before any of this: the oldest org_settings row. Every pre-existing row
-- of every table below belongs to it.
CREATE OR REPLACE FUNCTION private.primary_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.org_settings ORDER BY created_at LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.primary_org() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.primary_org() TO service_role;

UPDATE public.properties SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.deals SET org_id = private.primary_org() WHERE org_id IS NULL;

-- New rows: a property gets the creator's own office; a deal gets its property's office, or the
-- assignee's office, or the creator's own office (whichever resolves first).
CREATE OR REPLACE FUNCTION private.fill_property_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := COALESCE(public.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_fill_org ON public.properties;
CREATE TRIGGER a_fill_org BEFORE INSERT ON public.properties
FOR EACH ROW EXECUTE FUNCTION private.fill_property_org();

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
  SELECT p.org_id FROM public.leases l
  JOIN public.units u ON u.id = l.unit_id JOIN public.properties p ON p.id = u.property_id
  WHERE l.id = _id
$$;

CREATE OR REPLACE FUNCTION private.fill_deal_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := COALESCE(
      private.org_of_property(NEW.property_id),
      (SELECT m.org_id FROM public.org_members m WHERE m.user_id = NEW.assigned_to AND m.kind = 'member' LIMIT 1),
      public.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_fill_org ON public.deals;
CREATE TRIGGER a_fill_org BEFORE INSERT ON public.deals
FOR EACH ROW EXECUTE FUNCTION private.fill_deal_org();

REVOKE ALL ON FUNCTION private.org_of_property(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.org_of_unit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.org_of_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.org_of_property(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.org_of_unit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.org_of_lease(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2) staff_scope_ok: true for a non-staff caller (their access is governed entirely by the
--    existing permissive owner/tenant policies, untouched by this migration); for staff, true
--    only when they belong to the row's office. NULL org (cannot be resolved, e.g. an orphaned
--    row) fails closed.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.staff_scope_ok(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_staff(auth.uid())
      OR (_org IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.org_members m
            WHERE m.user_id = auth.uid() AND m.org_id = _org AND m.kind = 'member'))
$$;
REVOKE ALL ON FUNCTION private.staff_scope_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.staff_scope_ok(uuid) TO authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 3) One RESTRICTIVE policy per table. AS RESTRICTIVE means it is ANDed with the existing
--    permissive policies rather than replacing them: an owner or tenant's existing access is
--    completely unaffected; only the "is_staff() gives access to every row on the platform" path
--    gains the extra "and it's your own office" requirement.
-- ---------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS org_isolation ON public.properties;
CREATE POLICY org_isolation ON public.properties AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

DROP POLICY IF EXISTS org_isolation ON public.units;
CREATE POLICY org_isolation ON public.units AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id)));

DROP POLICY IF EXISTS org_isolation ON public.leases;
CREATE POLICY org_isolation ON public.leases AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_unit(unit_id)));

DROP POLICY IF EXISTS org_isolation ON public.payments;
CREATE POLICY org_isolation ON public.payments AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_lease(lease_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_lease(lease_id)));

DROP POLICY IF EXISTS org_isolation ON public.invoices;
CREATE POLICY org_isolation ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_lease(lease_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_lease(lease_id)));

DROP POLICY IF EXISTS org_isolation ON public.expenses;
CREATE POLICY org_isolation ON public.expenses AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.org_of_unit(unit_id))))
WITH CHECK (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.org_of_unit(unit_id))));

DROP POLICY IF EXISTS org_isolation ON public.deals;
CREATE POLICY org_isolation ON public.deals AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

-- These tables already carry org_id (added by an earlier migration in this database) but had no
-- RESTRICTIVE policy actually enforcing it — is_staff(auth.uid()) alone still governed access.
DROP POLICY IF EXISTS org_isolation ON public.tenants;
CREATE POLICY org_isolation ON public.tenants AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

DROP POLICY IF EXISTS org_isolation ON public.maintenance_requests;
CREATE POLICY org_isolation ON public.maintenance_requests AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

DROP POLICY IF EXISTS org_isolation ON public.whatsapp_channels;
CREATE POLICY org_isolation ON public.whatsapp_channels AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

DROP POLICY IF EXISTS org_isolation ON public.whatsapp_messages;
CREATE POLICY org_isolation ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

DROP POLICY IF EXISTS org_isolation ON public.unit_requests;
CREATE POLICY org_isolation ON public.unit_requests AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

-- Backfill: every existing row of these already-org_id-bearing tables that was left NULL (no
-- office link at all, e.g. tenants/maintenance created before org_id existed) belongs to the one
-- pre-existing office.
UPDATE public.tenants SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.maintenance_requests SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.whatsapp_channels SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.unit_requests SET org_id = private.primary_org() WHERE org_id IS NULL;
-- whatsapp_messages is left as-is: a NULL org_id there is an inbound message not yet matched to a
-- channel, and staff_scope_ok fails closed on NULL, so no staff can read it either way — safe.

-- notifications: user_id = auth.uid() already restricts a non-staff caller to their own rows via
-- the existing permissive policy: notifications carries no office concept of its own (it is
-- addressed to a person, not an office), so it is intentionally left out of this migration.
