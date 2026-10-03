-- كسر التكرار اللانهائي بين سياسات units وleases بإعادة صياغتها عبر دوال SECURITY DEFINER
DROP POLICY IF EXISTS units_read ON public.units;
DROP POLICY IF EXISTS leases_read ON public.leases;
DROP POLICY IF EXISTS payments_read ON public.payments;
DROP POLICY IF EXISTS maint_read ON public.maintenance_requests;

CREATE POLICY units_read ON public.units FOR SELECT
USING (
  is_staff(auth.uid())
  OR owner_id = auth.uid()
  OR private.unit_owner(id) = auth.uid()
  OR private.unit_tenant_user(id) = auth.uid()
);

CREATE POLICY leases_read ON public.leases FOR SELECT
USING (
  is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = leases.tenant_id AND t.user_id = auth.uid())
  OR private.unit_owner(leases.unit_id) = auth.uid()
);

CREATE POLICY payments_read ON public.payments FOR SELECT
USING (
  is_staff(auth.uid())
  OR EXISTS (
    SELECT 1 FROM leases l JOIN tenants t ON t.id = l.tenant_id
    WHERE l.id = payments.lease_id AND t.user_id = auth.uid()
  )
  OR EXISTS (
    SELECT 1 FROM leases l
    WHERE l.id = payments.lease_id AND private.unit_owner(l.unit_id) = auth.uid()
  )
);

CREATE POLICY maint_read ON public.maintenance_requests FOR SELECT
USING (
  is_staff(auth.uid())
  OR technician_id = auth.uid()
  OR EXISTS (SELECT 1 FROM tenants t WHERE t.id = maintenance_requests.tenant_id AND t.user_id = auth.uid())
  OR private.unit_owner(maintenance_requests.unit_id) = auth.uid()
);