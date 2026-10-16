-- Portal read gaps for technicians and tenants (QA 2026-10-16).
--
-- 1) A technician couldn't read the unit or property of a job assigned to them, so /portal showed
--    "وحدة —". They may now read the unit and its property for every job assigned to them that
--    isn't cancelled. Done jobs stay readable so the job history keeps its location; a cancelled
--    job (possibly never visited) and a job reassigned to someone else give no access.
-- 2) A tenant couldn't read their own building's name. They may now read the property of any unit
--    they hold an active lease on (the same lease that already lets them read the unit).
-- 3) The technician gets the reporting tenant's name and phone through technician_job_contacts(),
--    for open jobs only. RLS works per row, so a tenants policy would also hand over national_id,
--    email and the office's notes; the RPC returns just the two contact fields.
--
-- The policies are permissive and only add rows. The RESTRICTIVE org_isolation_select policies
-- on units and properties still apply: private.staff_scope_ok() is true for non-staff callers, so
-- technicians and tenants pass it, and a staff member is still held to their own office.
-- The helpers are SECURITY DEFINER set-returning functions (no RLS recursion through
-- maintenance_requests / leases / tenants), evaluated once per query via IN (SELECT ...).

CREATE OR REPLACE FUNCTION private.technician_unit_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT m.unit_id
  FROM public.maintenance_requests m
  WHERE m.technician_id = auth.uid() AND m.unit_id IS NOT NULL AND m.status <> 'cancelled'
$$;

CREATE OR REPLACE FUNCTION private.technician_property_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT u.property_id
  FROM public.maintenance_requests m JOIN public.units u ON u.id = m.unit_id
  WHERE m.technician_id = auth.uid() AND m.status <> 'cancelled'
$$;

CREATE OR REPLACE FUNCTION private.tenant_property_ids() RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT u.property_id
  FROM public.leases l
  JOIN public.tenants t ON t.id = l.tenant_id
  JOIN public.units u ON u.id = l.unit_id
  WHERE t.user_id = auth.uid() AND l.status = 'active'
$$;

REVOKE ALL ON FUNCTION private.technician_unit_ids(), private.technician_property_ids(),
  private.tenant_property_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.technician_unit_ids(), private.technician_property_ids(),
  private.tenant_property_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS units_technician_read ON public.units;
CREATE POLICY units_technician_read ON public.units FOR SELECT TO authenticated
USING (id IN (SELECT private.technician_unit_ids()));

DROP POLICY IF EXISTS properties_technician_read ON public.properties;
CREATE POLICY properties_technician_read ON public.properties FOR SELECT TO authenticated
USING (id IN (SELECT private.technician_property_ids()));

DROP POLICY IF EXISTS properties_tenant_read ON public.properties;
CREATE POLICY properties_tenant_read ON public.properties FOR SELECT TO authenticated
USING (id IN (SELECT private.tenant_property_ids()));

-- The tenant to call about each open job assigned to the caller: the tenant who reported it, or
-- the unit's current tenant when the office opened the request itself.
CREATE OR REPLACE FUNCTION public.technician_job_contacts()
RETURNS TABLE(request_id uuid, tenant_name text, tenant_phone text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, t.full_name, t.phone
  FROM public.maintenance_requests m
  JOIN public.tenants t ON t.id = COALESCE(m.tenant_id, (
    SELECT l.tenant_id FROM public.leases l
    WHERE l.unit_id = m.unit_id AND l.status = 'active'
    ORDER BY l.start_date DESC LIMIT 1
  ))
  WHERE auth.uid() IS NOT NULL
    AND m.technician_id = auth.uid()
    AND m.status NOT IN ('done', 'cancelled')
$$;
REVOKE ALL ON FUNCTION public.technician_job_contacts() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.technician_job_contacts() TO authenticated, service_role;
