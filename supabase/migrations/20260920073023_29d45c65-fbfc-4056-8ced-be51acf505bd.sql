ALTER TABLE public.units ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.unit_owner(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(u.owner_id, p.owner_id)
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = _unit_id
$$;
REVOKE EXECUTE ON FUNCTION public.unit_owner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unit_owner(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.unit_tenant_user(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT t.user_id FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.unit_id = _unit_id AND l.status = 'active'
  ORDER BY l.start_date DESC LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION public.unit_tenant_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.unit_tenant_user(uuid) TO authenticated;

DROP POLICY IF EXISTS units_read ON public.units;
CREATE POLICY units_read ON public.units FOR SELECT TO authenticated
USING (
  is_staff(auth.uid())
  OR owner_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id = units.property_id AND p.owner_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id WHERE l.unit_id = units.id AND t.user_id = auth.uid())
);

CREATE TABLE IF NOT EXISTS public.unit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'update',
  title text NOT NULL,
  body text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_events TO authenticated;
GRANT ALL ON public.unit_events TO service_role;
ALTER TABLE public.unit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY unit_events_read ON public.unit_events FOR SELECT TO authenticated
USING (
  is_staff(auth.uid())
  OR public.unit_owner(unit_id) = auth.uid()
  OR public.unit_tenant_user(unit_id) = auth.uid()
);
CREATE POLICY unit_events_write ON public.unit_events FOR ALL TO authenticated
USING (is_staff(auth.uid())) WITH CHECK (is_staff(auth.uid()));

CREATE INDEX IF NOT EXISTS unit_events_unit_idx ON public.unit_events (unit_id, created_at DESC);

-- إشعار المالك والمستأجر + سجل الوحدة
CREATE OR REPLACE FUNCTION public.notify_unit(_unit_id uuid, _title text, _body text, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o uuid; t uuid;
BEGIN
  INSERT INTO public.unit_events (unit_id, kind, title, body) VALUES (_unit_id, _kind, _title, _body);
  o := public.unit_owner(_unit_id);
  t := public.unit_tenant_user(_unit_id);
  IF o IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
    VALUES (o, _title, _body, _kind, 'system', 'units', _unit_id);
  END IF;
  IF t IS NOT NULL AND t IS DISTINCT FROM o THEN
    INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
    VALUES (t, _title, _body, _kind, 'system', 'units', _unit_id);
  END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION public.notify_unit(uuid, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.on_payment_paid()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE u uuid;
BEGIN
  IF NEW.status = 'paid' AND COALESCE(OLD.status, '') <> 'paid' THEN
    SELECT l.unit_id INTO u FROM public.leases l WHERE l.id = NEW.lease_id;
    IF u IS NOT NULL THEN
      PERFORM public.notify_unit(u, 'تم تسجيل دفعة مسددة',
        'مبلغ ' || to_char(NEW.amount, 'FM999999999.00') || ' ريال — تاريخ الاستحقاق ' || NEW.due_date::text, 'payment');
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS payments_notify_paid ON public.payments;
CREATE TRIGGER payments_notify_paid AFTER UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.on_payment_paid();

CREATE OR REPLACE FUNCTION public.on_unit_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.notify_unit(NEW.id, 'تحديث حالة الوحدة ' || NEW.unit_number,
      'الحالة الجديدة: ' || NEW.status, 'unit');
  ELSIF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent THEN
    PERFORM public.notify_unit(NEW.id, 'تحديث إيجار الوحدة ' || NEW.unit_number,
      'الإيجار السنوي الجديد: ' || to_char(NEW.annual_rent, 'FM999999999.00') || ' ريال', 'unit');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS units_notify_change ON public.units;
CREATE TRIGGER units_notify_change AFTER UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION public.on_unit_changed();

CREATE OR REPLACE FUNCTION public.on_maintenance_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.notify_unit(NEW.unit_id, 'تحديث طلب صيانة: ' || NEW.title,
      'الحالة: ' || NEW.status, 'maintenance');
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS maintenance_notify_change ON public.maintenance_requests;
CREATE TRIGGER maintenance_notify_change AFTER INSERT OR UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION public.on_maintenance_changed();