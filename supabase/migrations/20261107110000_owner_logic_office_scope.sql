-- =============================================================================================
-- Office resolution and data scoping (owner-logic review 2026-11-07, package P2: C2 H7 M13 M14
-- M16 M18).
--
--  * A unit's office is COALESCE(properties.org_id, the office of the live agreement on it)
--    (private.unit_office). org_of_unit / org_of_lease return it, so an office managing an
--    owner-registered unit under an agreement can lease it, record its payments and open its
--    maintenance (C2). Where an agreement permission gated a write it still does: the "home"
--    branch of every office check is the PROPERTY's office (private.unit_scope_ok), and an
--    agreement office passes only with the permission (leasing / collection / maintenance …).
--  * Rows filed under an office stay there (fill_org_id no longer re-derives org_id on UPDATE);
--    guard_same_org judges only references being set, and accepts an owner-registered property
--    when the row's office manages one of its units.
--  * Leases record the owner at signing (leases.owner_id); owner reads of leases/payments follow
--    it, so a unit's new owner doesn't inherit the old owner's leases (M13).
--  * A tenant sees a unit's thread and event log only from their own tenancy onward; lease
--    notices go to that lease's tenant (notify_lease_tenant, on_payment_paid) (H7). Thread sender
--    role and name are set by the database, not the browser (M14).
--  * A staff member who is also an owner keeps the properties they register for themselves
--    office-less and can still edit them (M18). Units created vacant get vacant_since (M16).
--
-- Depends on 20261107100000 (P1): live-aware private.unit_agreement_org / agreement_permission.
-- Every CREATE OR REPLACE starts from the newest definition of that object and keeps its existing
-- behaviour unless a comment says otherwise. Replay-safe: IF NOT EXISTS / DROP … IF EXISTS
-- throughout, backfills only touch rows still NULL.
-- =============================================================================================

-- ── 1. Leases record their owner (M13) ──────────────────────────────────────────────────────────
-- Added first: SQL helpers below read the column, and SQL function bodies are checked on creation.
ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS leases_owner_id_idx ON public.leases (owner_id);
COMMENT ON COLUMN public.leases.owner_id IS
  'The unit owner when the lease was signed (private.unit_owner at INSERT). Owner history follows this, not the unit''s current owner.';

-- ── 2. Office resolution helpers ────────────────────────────────────────────────────────────────
/** The office of the unit's property (the office that registered it), NULL for an owner's own. */
CREATE OR REPLACE FUNCTION private.unit_property_org(_unit_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.org_id FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE u.id = _unit_id
$$;

/** Shared contract: the office managing the unit — its property's office, else the live agreement's. */
CREATE OR REPLACE FUNCTION private.unit_office(_unit_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id))
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = _unit_id
$$;

-- Newest definitions: 20260924110000. Now the unit's office, not only the property's.
CREATE OR REPLACE FUNCTION private.org_of_unit(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.unit_office(_id)
$$;
CREATE OR REPLACE FUNCTION private.org_of_lease(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.unit_office(l.unit_id) FROM public.leases l WHERE l.id = _id
$$;

CREATE OR REPLACE FUNCTION private.lease_unit(_lease_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT unit_id FROM public.leases WHERE id = _lease_id
$$;
CREATE OR REPLACE FUNCTION private.lease_owner(_lease_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT owner_id FROM public.leases WHERE id = _lease_id
$$;
/** Money already recorded on the lease (a paid or part-paid installment). */
CREATE OR REPLACE FUNCTION private.lease_has_paid_installment(_lease_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.payments p
                 WHERE p.lease_id = _lease_id AND p.status IN ('paid', 'partial'))
$$;

/**
 * staff_scope_ok for a unit, for RLS: true for a non-staff caller (their own policies decide); for
 * staff, true when they belong to the office of the unit's PROPERTY, or to an office whose live
 * agreement on the unit grants one of _perms. An agreement office is the unit's office
 * (unit_office) but still needs the permission for the writes it gates.
 */
CREATE OR REPLACE FUNCTION private.unit_scope_ok(_unit_id uuid, _perms text[] DEFAULT '{}')
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.staff_scope_ok(private.unit_property_org(_unit_id))
      OR EXISTS (SELECT 1 FROM unnest(_perms) AS g(perm)
                 WHERE private.agreement_permission(_unit_id, public.my_org_id(), g.perm))
$$;

/** Does this property belong to the office: its own org_id, or (owner-registered) one unit it manages. */
CREATE OR REPLACE FUNCTION private.property_office_ok(_property_id uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT CASE
      WHEN p.org_id IS NOT NULL THEN p.org_id = _org
      ELSE EXISTS (SELECT 1 FROM public.units u
                   WHERE u.property_id = p.id AND private.unit_office(u.id) IS NOT DISTINCT FROM _org)
    END
    FROM public.properties p WHERE p.id = _property_id
  ), _org IS NULL)
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'private.unit_property_org(uuid)', 'private.unit_office(uuid)', 'private.org_of_unit(uuid)',
    'private.org_of_lease(uuid)', 'private.lease_unit(uuid)', 'private.lease_owner(uuid)',
    'private.lease_has_paid_installment(uuid)', 'private.unit_scope_ok(uuid, text[])',
    'private.property_office_ok(uuid, uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- Newest definition: 20260924000346, which resolved the office through the OWNER's office
-- membership (NULL for nearly every owner, so orgOf() threw). Server code uses it to address staff
-- notifications; it now returns the row's office.
CREATE OR REPLACE FUNCTION public.org_of(_table text, _id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r uuid;
BEGIN
  IF _table = 'properties' THEN r := private.org_of_property(_id);
  ELSIF _table = 'units' THEN r := private.unit_office(_id);
  ELSIF _table = 'leases' THEN r := private.org_of_lease(_id);
  ELSIF _table = 'payments' THEN
    SELECT private.org_of_lease(p.lease_id) INTO r FROM public.payments p WHERE p.id = _id;
  ELSIF _table = 'tenants' THEN SELECT t.org_id INTO r FROM public.tenants t WHERE t.id = _id;
  ELSIF _table = 'maintenance_requests' THEN
    SELECT COALESCE(q.org_id, private.unit_office(q.unit_id)) INTO r
    FROM public.maintenance_requests q WHERE q.id = _id;
  ELSIF _table = 'unit_requests' THEN SELECT x.org_id INTO r FROM public.unit_requests x WHERE x.id = _id;
  ELSIF _table = 'whatsapp_channels' THEN SELECT w.org_id INTO r FROM public.whatsapp_channels w WHERE w.id = _id;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.org_of(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_of(text, uuid) TO service_role;

-- ── 3. leases.owner_id: filled at signing, never edited from the app ─────────────────────────────
-- The one other writer is the sale of an occupied unit (below): the running lease moves to the new
-- owner, flagged by jarak.lease_owner_sync for the length of that update.
CREATE OR REPLACE FUNCTION private.fill_lease_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.owner_id := private.unit_owner(NEW.unit_id);
  ELSIF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    NEW.owner_id := private.unit_owner(NEW.unit_id);
  ELSIF current_setting('jarak.lease_owner_sync', true) = 'on' AND NEW.status = 'active' THEN
    NEW.owner_id := private.unit_owner(NEW.unit_id);
  ELSIF auth.uid() IS NOT NULL THEN
    NEW.owner_id := OLD.owner_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.fill_lease_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_fill_lease_owner ON public.leases;
CREATE TRIGGER a_fill_lease_owner BEFORE INSERT OR UPDATE ON public.leases
FOR EACH ROW EXECUTE FUNCTION private.fill_lease_owner();

-- A unit sold with a tenant in it: its ACTIVE leases follow the new owner (the unit's own owner, or
-- the property's for units without one). Ended, expired, renewed and terminated leases stay with the
-- owner who had them.
CREATE OR REPLACE FUNCTION private.sync_active_lease_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM set_config('jarak.lease_owner_sync', 'on', true);
  IF TG_TABLE_NAME = 'units' THEN
    UPDATE public.leases l SET owner_id = private.unit_owner(l.unit_id)
    WHERE l.unit_id = NEW.id AND l.status = 'active'
      AND l.owner_id IS DISTINCT FROM private.unit_owner(l.unit_id);
  ELSE
    UPDATE public.leases l SET owner_id = private.unit_owner(l.unit_id)
    FROM public.units u
    WHERE u.property_id = NEW.id AND u.owner_id IS NULL AND l.unit_id = u.id AND l.status = 'active'
      AND l.owner_id IS DISTINCT FROM private.unit_owner(l.unit_id);
  END IF;
  PERFORM set_config('jarak.lease_owner_sync', 'off', true);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.sync_active_lease_owner() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS z_sync_active_lease_owner ON public.units;
CREATE TRIGGER z_sync_active_lease_owner AFTER UPDATE OF owner_id ON public.units
FOR EACH ROW WHEN (NEW.owner_id IS DISTINCT FROM OLD.owner_id)
EXECUTE FUNCTION private.sync_active_lease_owner();
DROP TRIGGER IF EXISTS z_sync_active_lease_owner ON public.properties;
CREATE TRIGGER z_sync_active_lease_owner AFTER UPDATE OF owner_id ON public.properties
FOR EACH ROW WHEN (NEW.owner_id IS DISTINCT FROM OLD.owner_id)
EXECUTE FUNCTION private.sync_active_lease_owner();

-- Existing leases: the unit's current owner is the best record there is. Triggers are off for the
-- backfill (a data fix, not an edit: no audit rows, no lease guards re-judging old rows).
ALTER TABLE public.leases DISABLE TRIGGER USER;
UPDATE public.leases l SET owner_id = private.unit_owner(l.unit_id) WHERE l.owner_id IS NULL;
ALTER TABLE public.leases ENABLE TRIGGER USER;

-- ── 4. Office isolation (restrictive) policies ──────────────────────────────────────────────────
-- properties / units (newest: 20260924135836). Added only: a staff member who is also an owner
-- reaches their own office-less property and its units, which their owner policies already let
-- them read and write (M18). Office-registered rows are unchanged.
DROP POLICY IF EXISTS org_isolation ON public.properties;
DROP POLICY IF EXISTS org_isolation_select ON public.properties;
DROP POLICY IF EXISTS org_isolation_insert ON public.properties;
DROP POLICY IF EXISTS org_isolation_update ON public.properties;
DROP POLICY IF EXISTS org_isolation_delete ON public.properties;
CREATE POLICY org_isolation_select ON public.properties AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(org_id) OR private.property_agreement_view_ok(id)
       OR (org_id IS NULL AND owner_id = auth.uid()));
CREATE POLICY org_isolation_insert ON public.properties AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(org_id) OR (org_id IS NULL AND owner_id = auth.uid()));
CREATE POLICY org_isolation_update ON public.properties AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(org_id) OR (org_id IS NULL AND owner_id = auth.uid()))
WITH CHECK (private.staff_scope_ok(org_id) OR (org_id IS NULL AND owner_id = auth.uid()));
CREATE POLICY org_isolation_delete ON public.properties AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(org_id) OR (org_id IS NULL AND owner_id = auth.uid()));

DROP POLICY IF EXISTS org_isolation ON public.units;
DROP POLICY IF EXISTS org_isolation_select ON public.units;
DROP POLICY IF EXISTS org_isolation_insert ON public.units;
DROP POLICY IF EXISTS org_isolation_update ON public.units;
DROP POLICY IF EXISTS org_isolation_delete ON public.units;
CREATE POLICY org_isolation_select ON public.units AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'view')
       OR private.owner_managed_property(property_id));
CREATE POLICY org_isolation_insert ON public.units AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.owner_managed_property(property_id));
CREATE POLICY org_isolation_update ON public.units AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'pricing')
       OR private.agreement_permission(id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(id, public.my_org_id(), 'renewal_eviction')
       OR private.owner_managed_property(property_id))
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'pricing')
       OR private.agreement_permission(id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(id, public.my_org_id(), 'renewal_eviction')
       OR private.owner_managed_property(property_id));
CREATE POLICY org_isolation_delete ON public.units AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.owner_managed_property(property_id));

-- leases (newest: 20260924135836). Reading follows the unit's office (now including the live
-- agreement office); writes keep the agreement permissions they had. An agreement office with
-- `leasing` may also delete a lease with nothing paid on it (the «عقد جديد» rollback used to delete
-- nothing, C2).
DROP POLICY IF EXISTS org_isolation ON public.leases;
DROP POLICY IF EXISTS org_isolation_select ON public.leases;
DROP POLICY IF EXISTS org_isolation_insert ON public.leases;
DROP POLICY IF EXISTS org_isolation_update ON public.leases;
DROP POLICY IF EXISTS org_isolation_delete ON public.leases;
CREATE POLICY org_isolation_select ON public.leases AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'view'));
CREATE POLICY org_isolation_insert ON public.leases AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.unit_scope_ok(unit_id, ARRAY['leasing']));
CREATE POLICY org_isolation_update ON public.leases AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.unit_scope_ok(unit_id, ARRAY['leasing', 'ejar', 'renewal_eviction']))
WITH CHECK (private.unit_scope_ok(unit_id, ARRAY['leasing', 'ejar', 'renewal_eviction']));
CREATE POLICY org_isolation_delete ON public.leases AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.unit_scope_ok(unit_id)
       OR (private.unit_scope_ok(unit_id, ARRAY['leasing'])
           AND NOT private.lease_has_paid_installment(id)));

-- payments (newest: 20260924110000, one FOR ALL policy). Same rule for the property's office; an
-- agreement office reads with any live agreement, adds a schedule with `leasing` (or
-- `collection`), records collections with `collection`, and removes only unpaid rows with `leasing`.
DROP POLICY IF EXISTS org_isolation ON public.payments;
DROP POLICY IF EXISTS org_isolation_select ON public.payments;
DROP POLICY IF EXISTS org_isolation_insert ON public.payments;
DROP POLICY IF EXISTS org_isolation_update ON public.payments;
DROP POLICY IF EXISTS org_isolation_delete ON public.payments;
CREATE POLICY org_isolation_select ON public.payments AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_lease(lease_id))
       OR private.agreement_permission(private.lease_unit(lease_id), public.my_org_id(), 'view'));
CREATE POLICY org_isolation_insert ON public.payments AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['leasing', 'collection']));
CREATE POLICY org_isolation_update ON public.payments AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['collection']))
WITH CHECK (private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['collection']));
CREATE POLICY org_isolation_delete ON public.payments AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.unit_scope_ok(private.lease_unit(lease_id))
       OR (status NOT IN ('paid', 'partial')
           AND private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['leasing'])));

-- invoices (newest: 20260924110000). Lease invoices as payments, written with `collection`. An
-- invoice with no lease used to resolve to no office at all (staff could neither issue nor read
-- one); it now belongs to the office it was filed under (org_id, set by fill_org_id).
DROP POLICY IF EXISTS org_isolation ON public.invoices;
DROP POLICY IF EXISTS org_isolation_select ON public.invoices;
DROP POLICY IF EXISTS org_isolation_insert ON public.invoices;
DROP POLICY IF EXISTS org_isolation_update ON public.invoices;
DROP POLICY IF EXISTS org_isolation_delete ON public.invoices;
CREATE POLICY org_isolation_select ON public.invoices AS RESTRICTIVE FOR SELECT TO authenticated
USING (CASE WHEN lease_id IS NULL THEN private.staff_scope_ok(org_id)
            ELSE private.staff_scope_ok(private.org_of_lease(lease_id))
                 OR private.agreement_permission(private.lease_unit(lease_id), public.my_org_id(), 'view')
       END);
CREATE POLICY org_isolation_insert ON public.invoices AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (CASE WHEN lease_id IS NULL THEN private.staff_scope_ok(org_id)
                 ELSE private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['collection']) END);
CREATE POLICY org_isolation_update ON public.invoices AS RESTRICTIVE FOR UPDATE TO authenticated
USING (CASE WHEN lease_id IS NULL THEN private.staff_scope_ok(org_id)
            ELSE private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['collection']) END)
WITH CHECK (CASE WHEN lease_id IS NULL THEN private.staff_scope_ok(org_id)
                 ELSE private.unit_scope_ok(private.lease_unit(lease_id), ARRAY['collection']) END);
CREATE POLICY org_isolation_delete ON public.invoices AS RESTRICTIVE FOR DELETE TO authenticated
USING (CASE WHEN lease_id IS NULL THEN private.staff_scope_ok(org_id)
            ELSE private.unit_scope_ok(private.lease_unit(lease_id)) END);

-- expenses (newest: 20260924110000). Reading unchanged in shape (org_of_unit now covers agreement
-- units); an agreement office writes a unit's expenses with `maintenance` or `collection`.
DROP POLICY IF EXISTS org_isolation ON public.expenses;
DROP POLICY IF EXISTS org_isolation_select ON public.expenses;
DROP POLICY IF EXISTS org_isolation_insert ON public.expenses;
DROP POLICY IF EXISTS org_isolation_update ON public.expenses;
DROP POLICY IF EXISTS org_isolation_delete ON public.expenses;
CREATE POLICY org_isolation_select ON public.expenses AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.org_of_unit(unit_id))));
CREATE POLICY org_isolation_insert ON public.expenses AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.unit_property_org(unit_id)))
            OR (unit_id IS NOT NULL AND private.unit_scope_ok(unit_id, ARRAY['maintenance', 'collection'])));
CREATE POLICY org_isolation_update ON public.expenses AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.unit_property_org(unit_id)))
       OR (unit_id IS NOT NULL AND private.unit_scope_ok(unit_id, ARRAY['maintenance', 'collection'])))
WITH CHECK (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.unit_property_org(unit_id)))
            OR (unit_id IS NOT NULL AND private.unit_scope_ok(unit_id, ARRAY['maintenance', 'collection'])));
CREATE POLICY org_isolation_delete ON public.expenses AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.unit_property_org(unit_id)))
       OR (unit_id IS NOT NULL AND private.unit_scope_ok(unit_id, ARRAY['maintenance', 'collection'])));

-- maintenance_requests (newest: 20260924135836). Reading unchanged. A request on an agreement unit
-- is now filed under that office (fill_org_id), so "row of my office" alone would let it work the
-- unit without `maintenance`: writing also needs the unit's property office or that permission.
DROP POLICY IF EXISTS org_isolation_insert ON public.maintenance_requests;
DROP POLICY IF EXISTS org_isolation_update ON public.maintenance_requests;
DROP POLICY IF EXISTS org_isolation_delete ON public.maintenance_requests;
CREATE POLICY org_isolation_insert ON public.maintenance_requests AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK ((private.staff_scope_ok(org_id) AND (unit_id IS NULL OR private.unit_scope_ok(unit_id)))
            OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_update ON public.maintenance_requests AS RESTRICTIVE FOR UPDATE TO authenticated
USING ((private.staff_scope_ok(org_id) AND (unit_id IS NULL OR private.unit_scope_ok(unit_id)))
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')))
WITH CHECK ((private.staff_scope_ok(org_id) AND (unit_id IS NULL OR private.unit_scope_ok(unit_id)))
            OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_delete ON public.maintenance_requests AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(org_id) AND (unit_id IS NULL OR private.unit_scope_ok(unit_id)));

-- unit_messages (newest: 20260922090000). The property's office as before; an agreement office
-- reads and posts in the thread only with `tenant_comms`; the unit's owner reaches its thread even
-- when they are staff of another office (or of none on this unit).
DROP POLICY IF EXISTS org_isolation ON public.unit_messages;
CREATE POLICY org_isolation ON public.unit_messages AS RESTRICTIVE FOR ALL TO authenticated
USING (private.unit_scope_ok(unit_id, ARRAY['tenant_comms']) OR private.unit_owner(unit_id) = auth.uid())
WITH CHECK (private.unit_scope_ok(unit_id, ARRAY['tenant_comms']) OR private.unit_owner(unit_id) = auth.uid());

-- The other unit-level tables (newest: 20260922090000 / 20261008120000, one FOR ALL policy each).
-- org_of_unit / org_of_lease now include the live agreement office, which would let it write here
-- with any permission. Reading stays with any live agreement (view); writing needs the property's
-- office or the matching permission.
DO $$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('unit_photos',             'unit_id',                      'leasing'),
    ('unit_events',             'unit_id',                      'leasing'),
    ('repair_invoices',         'unit_id',                      'maintenance'),
    ('meter_readings',          'unit_id',                      'collection'),
    ('renewal_requests',        'private.lease_unit(lease_id)', 'renewal_eviction'),
    ('owner_renewal_decisions', 'private.lease_unit(lease_id)', 'renewal_eviction')
  ) AS v(tbl, unit_expr, perm)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS org_isolation ON public.%I', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_select ON public.%I', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_insert ON public.%I', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_update ON public.%I', spec.tbl);
    EXECUTE format('DROP POLICY IF EXISTS org_isolation_delete ON public.%I', spec.tbl);
    EXECUTE format(
      'CREATE POLICY org_isolation_select ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated
       USING (private.staff_scope_ok(private.unit_office(%2$s))
              OR private.agreement_permission(%2$s, public.my_org_id(), ''view''))',
      spec.tbl, spec.unit_expr);
    EXECUTE format(
      'CREATE POLICY org_isolation_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated
       WITH CHECK (private.unit_scope_ok(%s, ARRAY[%L]))',
      spec.tbl, spec.unit_expr, spec.perm);
    EXECUTE format(
      'CREATE POLICY org_isolation_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated
       USING (private.unit_scope_ok(%2$s, ARRAY[%3$L])) WITH CHECK (private.unit_scope_ok(%2$s, ARRAY[%3$L]))',
      spec.tbl, spec.unit_expr, spec.perm);
    EXECUTE format(
      'CREATE POLICY org_isolation_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated
       USING (private.unit_scope_ok(%s, ARRAY[%L]))',
      spec.tbl, spec.unit_expr, spec.perm);
  END LOOP;
END $$;

-- ── 5. Lease guard: tenant office and agreement permissions ─────────────────────────────────────
-- Newest definition: 20260924135836. Changed:
--  * the tenant must be of the unit's office (agreement office included), checked only when the
--    tenant or unit is being set, so an old lease is never blocked after the unit changes office;
--  * "home office" (skips the agreement permission rules) is the PROPERTY's office, so an agreement
--    office still needs leasing / ejar / renewal_eviction for what they gate.
CREATE OR REPLACE FUNCTION private.guard_lease_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE home_org_ok boolean;
BEGIN
  IF NEW.tenant_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
          OR NEW.unit_id IS DISTINCT FROM OLD.unit_id)
     AND (SELECT t.org_id FROM public.tenants t WHERE t.id = NEW.tenant_id)
         IS DISTINCT FROM private.unit_office(NEW.unit_id) THEN
    RAISE EXCEPTION 'المستأجر ليس من نفس مكتب الوحدة' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  home_org_ok := private.staff_scope_ok(
    private.unit_property_org(CASE WHEN TG_OP = 'UPDATE' THEN OLD.unit_id ELSE NEW.unit_id END));
  IF home_org_ok THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
      RAISE EXCEPTION 'صلاحيتك لا تشمل إنشاء عقد جديد' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الوحدة المرتبطة بالعقد' USING ERRCODE = '42501';
  END IF;
  IF (NEW.ejar_contract_no IS DISTINCT FROM OLD.ejar_contract_no
      OR NEW.ejar_status IS DISTINCT FROM OLD.ejar_status)
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'ejar') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل إدارة إيجار (فال)' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('ended', 'terminated')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'renewal_eviction') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل الإنهاء أو الإخلاء' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'ejar_contract_no' - 'ejar_status' - 'status' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'ejar_contract_no' - 'ejar_status' - 'status' - 'updated_at')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل شروط العقد' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('ended', 'terminated')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل حالة العقد' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_lease_agreement_columns() FROM PUBLIC, anon, authenticated;

-- ── 6. org_id is derived from the parent, and stays put ─────────────────────────────────────────
-- Newest definition: 20260922110000. Changed:
--  * UPDATE keeps the office a row was filed under. The parent's office can change (an agreement
--    ends, another office takes over); the row's history doesn't move with it, and a client can no
--    longer re-point a parentless row at another office.
--  * A notification with no parent office stays office-less instead of falling back to the oldest
--    office (whose staff could then read it).
CREATE OR REPLACE FUNCTION private.fill_org_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j jsonb := to_jsonb(NEW); o uuid;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.org_id IS NOT NULL THEN
      NEW.org_id := OLD.org_id;
      RETURN NEW;
    END IF;
  END IF;

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
  ELSIF TG_TABLE_NAME = 'notifications' THEN
    NEW.org_id := COALESCE(
      CASE WHEN public.is_staff(auth.uid()) THEN private.my_org() ELSE NULL END, NEW.org_id);
  ELSE
    NEW.org_id := COALESCE(
      CASE WHEN public.is_staff(auth.uid()) THEN private.my_org() ELSE NULL END,
      NEW.org_id, private.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.fill_org_id() FROM PUBLIC;

-- Newest definition: 20260922110000. Changed:
--  * only references being set are judged (INSERT, a changed reference, or a changed org_id), so
--    editing an old row after its unit changed office doesn't fail;
--  * an owner-registered property (no org_id) belongs to the office managing one of its units;
--  * a tenant of another office is accepted when they hold a lease on the row's unit (the tenant
--    stays on when the unit's office changes).
CREATE OR REPLACE FUNCTION private.guard_same_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
-- `ref` rather than `id`: a variable called `id` is ambiguous against the column in `t.id = id`.
DECLARE
  j jsonb := to_jsonb(NEW);
  o jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  moved boolean := TG_OP = 'INSERT' OR (j->>'org_id') IS DISTINCT FROM (o->>'org_id');
  bad boolean := false;
  ref uuid;
  unit_ref uuid := private.try_uuid(j->>'unit_id');
BEGIN
  ref := unit_ref;
  IF ref IS NOT NULL AND (moved OR (j->>'unit_id') IS DISTINCT FROM (o->>'unit_id'))
     AND private.org_of_unit(ref) IS DISTINCT FROM NEW.org_id THEN bad := true; END IF;
  ref := private.try_uuid(j->>'property_id');
  IF ref IS NOT NULL AND (moved OR (j->>'property_id') IS DISTINCT FROM (o->>'property_id'))
     AND NOT private.property_office_ok(ref, NEW.org_id) THEN bad := true; END IF;
  ref := private.try_uuid(j->>'lease_id');
  IF ref IS NOT NULL AND (moved OR (j->>'lease_id') IS DISTINCT FROM (o->>'lease_id'))
     AND private.org_of_lease(ref) IS DISTINCT FROM NEW.org_id THEN bad := true; END IF;
  ref := private.try_uuid(j->>'tenant_id');
  IF ref IS NOT NULL AND (moved OR (j->>'tenant_id') IS DISTINCT FROM (o->>'tenant_id'))
     AND (SELECT t.org_id FROM public.tenants t WHERE t.id = ref) IS DISTINCT FROM NEW.org_id
     AND NOT (unit_ref IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.leases l WHERE l.tenant_id = ref AND l.unit_id = unit_ref)) THEN
    bad := true;
  END IF;
  IF bad THEN
    RAISE EXCEPTION 'لا يمكن ربط بيانات مكتب آخر بهذا السجل' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_same_org() FROM PUBLIC;

-- ── 7. An owner's own property stays office-less, even when they are also staff (M18) ───────────
-- Newest definition: 20261017100000. Changed: an account holding the owner role that registers a
-- property for itself (owner_id = itself) keeps org_id NULL even if it is also office staff. The
-- office screens never set owner_id on insert, so office properties are unaffected.
CREATE OR REPLACE FUNCTION private.fill_property_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL
     AND NOT (auth.uid() IS NOT NULL AND NEW.owner_id IS NOT NULL AND NEW.owner_id = auth.uid()
              AND (NOT public.is_staff(auth.uid()) OR public.has_role(auth.uid(), 'owner'))) THEN
    NEW.org_id := COALESCE(public.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;

-- ── 8. Owner history follows the lease's owner (M13) ────────────────────────────────────────────
-- Newest definitions: 20260920095610 (leases_read, payments_read) and 20261004100000
-- (audit_log_owner_read). Only the owner branch changed: private.unit_owner(unit) → leases.owner_id.
DROP POLICY IF EXISTS leases_read ON public.leases;
CREATE POLICY leases_read ON public.leases FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = leases.tenant_id AND t.user_id = auth.uid())
  OR leases.owner_id = auth.uid()
);

DROP POLICY IF EXISTS payments_read ON public.payments;
CREATE POLICY payments_read ON public.payments FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.id = payments.lease_id AND t.user_id = auth.uid()
  )
  OR private.lease_owner(payments.lease_id) = auth.uid()
);

DROP POLICY IF EXISTS audit_log_owner_read ON public.audit_log;
CREATE POLICY audit_log_owner_read ON public.audit_log FOR SELECT TO authenticated USING (
  CASE table_name
    WHEN 'properties' THEN EXISTS (
      SELECT 1 FROM public.properties p WHERE p.id = row_id AND p.owner_id = auth.uid())
    WHEN 'units' THEN private.unit_owner(row_id) = auth.uid()
    WHEN 'leases' THEN private.lease_owner(row_id) = auth.uid()
    WHEN 'maintenance_requests' THEN EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      WHERE mr.id = row_id AND private.unit_owner(mr.unit_id) = auth.uid())
    ELSE false
  END
);

-- ── 9. Tenancy-scoped threads and unit log (H7, M14) ────────────────────────────────────────────
-- Newest definition: 20260920073049. Unchanged but for a deterministic tie-break.
CREATE OR REPLACE FUNCTION private.unit_tenant_user(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.unit_id = _unit_id AND l.status = 'active'
  ORDER BY l.start_date DESC, l.created_at DESC LIMIT 1
$$;

/**
 * Where the caller's tenancy of the unit began, NULL when they hold no active lease on it. The
 * tenancy runs back through their earlier leases on the unit (renewals) until another tenant's
 * lease; it begins at the first lease's start date, or when it was signed if that came first.
 */
CREATE OR REPLACE FUNCTION private.tenant_thread_since(_unit_id uuid) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT min(LEAST(l.start_date::timestamp AT TIME ZONE 'Asia/Riyadh', l.created_at))
  FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE auth.uid() IS NOT NULL
    AND l.unit_id = _unit_id AND t.user_id = auth.uid()
    AND l.status IN ('active', 'expired', 'renewed', 'ended', 'terminated')
    AND NOT EXISTS (
      SELECT 1 FROM public.leases x JOIN public.tenants xt ON xt.id = x.tenant_id
      WHERE x.unit_id = _unit_id AND xt.user_id IS DISTINCT FROM auth.uid()
        AND x.status IN ('active', 'expired', 'renewed', 'ended', 'terminated')
        AND (x.start_date, x.created_at) > (l.start_date, l.created_at))
    AND EXISTS (
      SELECT 1 FROM public.leases a JOIN public.tenants ta ON ta.id = a.tenant_id
      WHERE a.unit_id = _unit_id AND ta.user_id = auth.uid() AND a.status = 'active')
$$;
REVOKE ALL ON FUNCTION private.tenant_thread_since(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.tenant_thread_since(uuid) TO authenticated, service_role;

-- Newest definitions: 20260920092519. The tenant branch now reads from their tenancy's start only.
DROP POLICY IF EXISTS unit_messages_read ON public.unit_messages;
CREATE POLICY unit_messages_read ON public.unit_messages FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR private.unit_owner(unit_id) = auth.uid()
  OR created_at >= private.tenant_thread_since(unit_id)
);
DROP POLICY IF EXISTS unit_messages_insert ON public.unit_messages;
CREATE POLICY unit_messages_insert ON public.unit_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND (
    public.is_staff(auth.uid())
    OR private.unit_owner(unit_id) = auth.uid()
    OR private.tenant_thread_since(unit_id) IS NOT NULL
  )
);

-- Newest definition: 20260920073049. Same tenancy rule for the unit's event log (payments, status).
DROP POLICY IF EXISTS unit_events_read ON public.unit_events;
CREATE POLICY unit_events_read ON public.unit_events FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR private.unit_owner(unit_id) = auth.uid()
  OR created_at >= private.tenant_thread_since(unit_id)
);

-- M14: who wrote a thread message is the database's call. A browser-supplied role or name is
-- replaced: «المكتب» only for staff of the unit's property office or of an agreement office with
-- `tenant_comms` (the same rule as the thread's isolation policy), then the owner, then its tenant.
CREATE OR REPLACE FUNCTION private.fill_unit_message_sender() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.sender_id := uid;
  NEW.sender_role := CASE
    WHEN public.is_staff(uid) AND private.unit_scope_ok(NEW.unit_id, ARRAY['tenant_comms']) THEN 'staff'
    WHEN private.unit_owner(NEW.unit_id) = uid THEN 'owner'
    WHEN private.tenant_thread_since(NEW.unit_id) IS NOT NULL THEN 'tenant'
    ELSE 'unknown' END;
  NEW.sender_name := (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = uid);
  NEW.created_at := now();
  NEW.read_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.fill_unit_message_sender() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS a_fill_sender ON public.unit_messages;
CREATE TRIGGER a_fill_sender BEFORE INSERT ON public.unit_messages
FOR EACH ROW EXECUTE FUNCTION private.fill_unit_message_sender();

-- ── 10. Notices: the unit's office, and lease notices to the lease's people (H7) ────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'notifications_link_check') THEN
    ALTER TABLE public.notifications ADD CONSTRAINT notifications_link_check
      CHECK (link IS NULL OR (link ~ '^/[^/\\]' AND char_length(link) <= 300));
  END IF;
END $$;
COMMENT ON COLUMN public.notifications.link IS 'Optional in-app path the notice points to (starts with a single /).';

-- Newest definition: 20260920073049. Changed: the notifications carry the unit's office (they used
-- to take the caller's, or the oldest office's for a tenant- or cron-triggered notice).
CREATE OR REPLACE FUNCTION public.notify_unit(_unit_id uuid, _title text, _body text, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; t uuid; org uuid := private.unit_office(_unit_id);
BEGIN
  INSERT INTO public.unit_events (unit_id, kind, title, body) VALUES (_unit_id, _kind, _title, _body);
  o := private.unit_owner(_unit_id);
  t := private.unit_tenant_user(_unit_id);
  IF o IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
    VALUES (o, org, _title, _body, _kind, 'system', 'units', _unit_id);
  END IF;
  IF t IS NOT NULL AND t IS DISTINCT FROM o THEN
    INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
    VALUES (t, org, _title, _body, _kind, 'system', 'units', _unit_id);
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.notify_unit(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

-- Newest definition: 20260920073023. Changed: a paid installment is announced to its own lease's
-- tenant and owner, not to whoever holds the unit now.
CREATE OR REPLACE FUNCTION public.on_payment_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid; ow uuid; tu uuid; org uuid; ttl text; msg text;
BEGIN
  IF NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid' THEN
    SELECT l.unit_id, l.owner_id, t.user_id INTO u, ow, tu
    FROM public.leases l LEFT JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.id = NEW.lease_id;
    IF u IS NOT NULL THEN
      ttl := 'تم تسجيل دفعة مسددة';
      msg := 'مبلغ ' || to_char(NEW.amount, 'FM999999999.00') || ' ريال — تاريخ الاستحقاق ' || NEW.due_date::text;
      org := private.unit_office(u);
      INSERT INTO public.unit_events (unit_id, kind, title, body) VALUES (u, 'payment', ttl, msg);
      IF ow IS NOT NULL THEN
        INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
        VALUES (ow, org, ttl, msg, 'payment', 'system', 'payments', NEW.id);
      END IF;
      IF tu IS NOT NULL AND tu IS DISTINCT FROM ow THEN
        INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
        VALUES (tu, org, ttl, msg, 'payment', 'system', 'payments', NEW.id);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.on_payment_paid() FROM PUBLIC, anon, authenticated;

/**
 * Shared contract: a notice about one lease, to that lease's tenant only (a deposit settlement or
 * a payment of an old lease must not reach the unit's next tenant). Staff of the lease's office, or
 * of an office with a live agreement on its unit; server jobs call it with no user. A tenant with
 * no account gets nothing (no error).
 */
CREATE OR REPLACE FUNCTION public.notify_lease_tenant(
  _lease_id uuid, _title text, _body text, _link text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE tu uuid; v_unit uuid;
BEGIN
  SELECT l.unit_id, t.user_id INTO v_unit, tu
  FROM public.leases l LEFT JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.id = _lease_id;
  IF v_unit IS NULL THEN
    RAISE EXCEPTION 'لم نجد العقد' USING ERRCODE = '02000';
  END IF;
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_staff(auth.uid())
              AND (private.staff_scope_ok(private.unit_office(v_unit))
                   OR private.agreement_permission(v_unit, public.my_org_id(), 'view'))) THEN
    RAISE EXCEPTION 'إشعار المستأجر لموظفي مكتب العقد فقط' USING ERRCODE = '42501';
  END IF;
  IF _title IS NULL OR btrim(_title) = '' OR char_length(_title) > 200 THEN
    RAISE EXCEPTION 'اكتب عنوان الإشعار (200 حرف كحد أقصى)' USING ERRCODE = '22023';
  END IF;
  IF char_length(COALESCE(_body, '')) > 2000 THEN
    RAISE EXCEPTION 'نص الإشعار أطول من 2000 حرف' USING ERRCODE = '22023';
  END IF;
  IF _link IS NOT NULL AND (_link !~ '^/[^/\\]' OR char_length(_link) > 300) THEN
    RAISE EXCEPTION 'رابط الإشعار يجب أن يكون مسارًا داخل جارك' USING ERRCODE = '22023';
  END IF;
  IF tu IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.notifications
    (user_id, org_id, title, body, kind, source, related_table, related_id, link)
  VALUES (tu, private.unit_office(v_unit), btrim(_title), NULLIF(btrim(COALESCE(_body, '')), ''),
          'lease', 'system', 'leases', _lease_id, _link);
END $$;
REVOKE ALL ON FUNCTION public.notify_lease_tenant(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_lease_tenant(uuid, text, text, text) TO authenticated, service_role;

-- ── 11. vacant_since for units created vacant (M16) ─────────────────────────────────────────────
-- Newest definition: 20260925130000 (UPDATE only). Now also on INSERT: a vacant unit is vacant from
-- its creation. The UPDATE path is unchanged (end_lease writes the move-out date separately).
CREATE OR REPLACE FUNCTION private.track_unit_vacant_since() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.vacant_since := CASE WHEN NEW.status = 'vacant' THEN now() END;
    RETURN NEW;
  END IF;
  IF NEW.status = 'vacant' AND OLD.status IS DISTINCT FROM 'vacant' THEN
    NEW.vacant_since := now();
    NEW.price_decayed_at := NULL;
  ELSIF NEW.status IS DISTINCT FROM 'vacant' THEN
    NEW.vacant_since := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS z_track_unit_vacant_since_insert ON public.units;
CREATE TRIGGER z_track_unit_vacant_since_insert BEFORE INSERT ON public.units
FOR EACH ROW EXECUTE FUNCTION private.track_unit_vacant_since();

-- Units created vacant since 20260925130000 never got a date: they have been vacant since they
-- were added. Triggers off for the data fix (no audit rows, no unit notifications).
ALTER TABLE public.units DISABLE TRIGGER USER;
UPDATE public.units SET vacant_since = created_at WHERE status = 'vacant' AND vacant_since IS NULL;
ALTER TABLE public.units ENABLE TRIGGER USER;
