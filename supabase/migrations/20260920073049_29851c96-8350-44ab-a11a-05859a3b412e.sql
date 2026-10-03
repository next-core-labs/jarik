CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.unit_owner(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(u.owner_id, p.owner_id)
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = _unit_id
$$;
CREATE OR REPLACE FUNCTION private.unit_tenant_user(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.unit_id = _unit_id AND l.status = 'active'
  ORDER BY l.start_date DESC LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION private.unit_owner(uuid), private.unit_tenant_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.unit_owner(uuid), private.unit_tenant_user(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS unit_events_read ON public.unit_events;
CREATE POLICY unit_events_read ON public.unit_events FOR SELECT TO authenticated
USING (
  is_staff(auth.uid())
  OR private.unit_owner(unit_id) = auth.uid()
  OR private.unit_tenant_user(unit_id) = auth.uid()
);

CREATE OR REPLACE FUNCTION public.notify_unit(_unit_id uuid, _title text, _body text, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; t uuid;
BEGIN
  INSERT INTO public.unit_events (unit_id, kind, title, body) VALUES (_unit_id, _kind, _title, _body);
  o := private.unit_owner(_unit_id);
  t := private.unit_tenant_user(_unit_id);
  IF o IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
    VALUES (o, _title, _body, _kind, 'system', 'units', _unit_id);
  END IF;
  IF t IS NOT NULL AND t IS DISTINCT FROM o THEN
    INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
    VALUES (t, _title, _body, _kind, 'system', 'units', _unit_id);
  END IF;
END; $$;

DROP FUNCTION IF EXISTS public.unit_owner(uuid);
DROP FUNCTION IF EXISTS public.unit_tenant_user(uuid);

REVOKE EXECUTE ON FUNCTION public.notify_unit(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_payment_paid() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_unit_changed() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_maintenance_changed() FROM PUBLIC, anon, authenticated;