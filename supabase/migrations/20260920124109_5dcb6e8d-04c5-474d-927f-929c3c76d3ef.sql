-- 1) Storage: restrict documents bucket reads to staff or the property owner
DROP POLICY IF EXISTS documents_read ON storage.objects;
CREATE POLICY documents_read ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'documents' AND (
    public.is_staff(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.property_documents d
      JOIN public.properties p ON p.id = d.property_id
      WHERE d.file_path = storage.objects.name AND p.owner_id = auth.uid()
    )
  )
);

-- 2) Public directory: stop exposing raw org_settings columns to anon
DROP POLICY IF EXISTS org_settings_public_directory ON public.org_settings;
ALTER VIEW public.office_directory SET (security_invoker = false);
GRANT SELECT ON public.office_directory TO anon, authenticated;

-- 3) Public vacant units listing without the properties join
DROP VIEW IF EXISTS public.vacant_units_public;
CREATE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street,
       u.floor_no, u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.furnished,
       o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
       o.city AS office_city, o.district AS office_district
FROM public.units u
JOIN public.org_settings o ON o.listed_publicly
WHERE u.status = 'vacant';
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- 4) Internal/trigger functions must not be callable from the browser
REVOKE EXECUTE ON FUNCTION public.audit_row() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_default_role() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_maintenance_changed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_payment_paid() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.on_unit_changed() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_unit_status() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_unit(uuid, text, text, text) FROM anon, authenticated;

-- 5) Staff-only manual notification wrapper
CREATE OR REPLACE FUNCTION public.notify_unit_staff(_unit_id uuid, _title text, _body text, _kind text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM public.notify_unit(_unit_id, _title, _body, _kind);
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_unit_staff(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_unit_staff(uuid, text, text, text) TO authenticated;

-- 6) Guard smart reminders (cron runs with no auth.uid())
CREATE OR REPLACE FUNCTION public.smart_payment_reminders()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
END $function$;
REVOKE EXECUTE ON FUNCTION public.smart_payment_reminders() FROM anon;

-- 7) Overdue count: staff or the tenant themselves
CREATE OR REPLACE FUNCTION public.tenant_overdue_count(_tenant_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n integer;
BEGIN
  IF NOT (
    public.is_staff(auth.uid())
    OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT count(*)::integer INTO n
  FROM public.payments p
  JOIN public.leases l ON l.id = p.lease_id
  WHERE l.tenant_id = _tenant_id AND p.status <> 'paid' AND p.due_date < current_date;
  RETURN n;
END $function$;
REVOKE EXECUTE ON FUNCTION public.tenant_overdue_count(uuid) FROM anon;

-- 8) Market stats / expiring-lease notifier: signed-in only
REVOKE EXECUTE ON FUNCTION public.market_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_expiring_leases(integer) FROM anon;
