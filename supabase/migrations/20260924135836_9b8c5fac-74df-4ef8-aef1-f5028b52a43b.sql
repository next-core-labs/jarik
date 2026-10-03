CREATE OR REPLACE FUNCTION private.property_agreement_view_ok(_property_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.property_id = _property_id
      AND private.agreement_permission(u.id, public.my_org_id(), 'view')
  )
$$;
REVOKE ALL ON FUNCTION private.property_agreement_view_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.property_agreement_view_ok(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS org_isolation ON public.properties;
CREATE POLICY org_isolation_select ON public.properties AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(org_id) OR private.property_agreement_view_ok(id));
CREATE POLICY org_isolation_insert ON public.properties AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(org_id));
CREATE POLICY org_isolation_update ON public.properties AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
CREATE POLICY org_isolation_delete ON public.properties AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(org_id));

DROP POLICY IF EXISTS org_isolation ON public.units;
CREATE POLICY org_isolation_select ON public.units AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'view'));
CREATE POLICY org_isolation_insert ON public.units AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id)));
CREATE POLICY org_isolation_update ON public.units AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'pricing')
       OR private.agreement_permission(id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(id, public.my_org_id(), 'renewal_eviction'))
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'pricing')
       OR private.agreement_permission(id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(id, public.my_org_id(), 'renewal_eviction'));
CREATE POLICY org_isolation_delete ON public.units AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id)));

CREATE OR REPLACE FUNCTION private.guard_unit_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid())
     OR private.staff_scope_ok(private.org_of_property(OLD.property_id)) THEN
    RETURN NEW;
  END IF;
  IF NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'لا يمكن نقل الوحدة لعقار آخر عبر اتفاقية إدارة' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير مالك الوحدة عبر اتفاقية إدارة' USING ERRCODE = '42501';
  END IF;
  IF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent
     AND NOT private.agreement_permission(NEW.id, public.my_org_id(), 'pricing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل الإيجار' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (private.agreement_permission(NEW.id, public.my_org_id(), 'leasing')
              OR private.agreement_permission(NEW.id, public.my_org_id(), 'renewal_eviction')) THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل حالة الوحدة' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'annual_rent' - 'status' - 'property_id' - 'owner_id' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'annual_rent' - 'status' - 'property_id' - 'owner_id' - 'updated_at')
     AND NOT private.agreement_permission(NEW.id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل بيانات الوحدة' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_unit_agreement_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_unit_agreement ON public.units;
CREATE TRIGGER guard_unit_agreement BEFORE UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION private.guard_unit_agreement_columns();

DROP POLICY IF EXISTS org_isolation ON public.leases;
CREATE POLICY org_isolation_select ON public.leases AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'view'));
CREATE POLICY org_isolation_insert ON public.leases AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'leasing'));
CREATE POLICY org_isolation_update ON public.leases AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'ejar')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'renewal_eviction'))
WITH CHECK (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'ejar')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'renewal_eviction'));
CREATE POLICY org_isolation_delete ON public.leases AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id)));

CREATE OR REPLACE FUNCTION private.guard_lease_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE home_org_ok boolean;
BEGIN
  IF NEW.tenant_id IS NOT NULL
     AND (SELECT t.org_id FROM public.tenants t WHERE t.id = NEW.tenant_id)
         IS DISTINCT FROM private.org_of_unit(NEW.unit_id) THEN
    RAISE EXCEPTION 'المستأجر ليس من نفس مكتب الوحدة' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  home_org_ok := private.staff_scope_ok(
    private.org_of_unit(CASE WHEN TG_OP = 'UPDATE' THEN OLD.unit_id ELSE NEW.unit_id END));
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
DROP TRIGGER IF EXISTS guard_lease_agreement ON public.leases;
CREATE TRIGGER guard_lease_agreement BEFORE INSERT OR UPDATE ON public.leases
FOR EACH ROW EXECUTE FUNCTION private.guard_lease_agreement_columns();

DROP POLICY IF EXISTS org_isolation ON public.maintenance_requests;
CREATE POLICY org_isolation_select ON public.maintenance_requests AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_insert ON public.maintenance_requests AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_update ON public.maintenance_requests AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')))
WITH CHECK (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_delete ON public.maintenance_requests AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(org_id));

CREATE OR REPLACE FUNCTION private.guard_maintenance_unit_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الوحدة المرتبطة بطلب الصيانة' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_maintenance_unit_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_maintenance_unit ON public.maintenance_requests;
CREATE TRIGGER guard_maintenance_unit BEFORE UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_maintenance_unit_immutable();

CREATE OR REPLACE FUNCTION private.guard_technician() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.technician_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_members m
                     WHERE m.user_id = NEW.technician_id AND m.kind = 'member' AND m.org_id = NEW.org_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members m
       WHERE m.user_id = NEW.technician_id
         AND m.kind = 'member'
         AND m.org_id = public.my_org_id()
         AND NEW.unit_id IS NOT NULL
         AND private.agreement_permission(NEW.unit_id, m.org_id, 'maintenance')
     ) THEN
    RAISE EXCEPTION 'الفني ليس من فريق هذا المكتب' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;