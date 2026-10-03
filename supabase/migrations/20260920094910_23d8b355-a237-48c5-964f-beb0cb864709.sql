-- 1) وديعة التأمين على العقد
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS deposit_status text NOT NULL DEFAULT 'held';
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS deposit_note text;

-- 2) مرفقات الصيانة السريعة
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS photo_path text;
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS audio_path text;

-- 3) إحداثيات العقار للخريطة
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS lat double precision;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS lng double precision;

-- 4) طلبات الوحدات من الزوار (عام)
CREATE TABLE public.unit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  city text,
  district text,
  unit_type text,
  budget numeric DEFAULT 0,
  notes text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.unit_requests TO anon, authenticated;
GRANT SELECT, UPDATE ON public.unit_requests TO authenticated;
GRANT ALL ON public.unit_requests TO service_role;
ALTER TABLE public.unit_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY unit_requests_anon_insert ON public.unit_requests FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY unit_requests_staff_read ON public.unit_requests FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));
CREATE POLICY unit_requests_staff_update ON public.unit_requests FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- 5) طلبات التجديد من المستأجر
CREATE TABLE public.renewal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  decision text NOT NULL CHECK (decision IN ('renew','leave')),
  note text,
  status text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.renewal_requests TO authenticated;
GRANT ALL ON public.renewal_requests TO service_role;
ALTER TABLE public.renewal_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY renewal_requests_read ON public.renewal_requests FOR SELECT TO authenticated USING (
  public.is_staff(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.id = renewal_requests.lease_id AND t.user_id = auth.uid()
  )
);
CREATE POLICY renewal_requests_insert ON public.renewal_requests FOR INSERT TO authenticated WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
    WHERE l.id = renewal_requests.lease_id AND t.user_id = auth.uid()
  )
);
CREATE POLICY renewal_requests_staff_update ON public.renewal_requests FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- 6) سجل التدقيق التلقائي
CREATE TABLE public.audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_id uuid,
  table_name text NOT NULL,
  row_id uuid,
  action text NOT NULL,
  summary jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_log_staff_read ON public.audit_log FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.audit_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid; actor uuid;
BEGIN
  rid := COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(OLD)->>'id')::uuid);
  actor := auth.uid();
  INSERT INTO public.audit_log(actor_id, table_name, row_id, action, summary)
  VALUES (actor, TG_TABLE_NAME, rid, TG_OP, to_jsonb(COALESCE(NEW, OLD)));
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE EXECUTE ON FUNCTION public.audit_row() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_row() TO authenticated, service_role;

DROP TRIGGER IF EXISTS audit_payments ON public.payments;
CREATE TRIGGER audit_payments AFTER INSERT OR UPDATE OR DELETE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.audit_row();
DROP TRIGGER IF EXISTS audit_leases ON public.leases;
CREATE TRIGGER audit_leases AFTER INSERT OR UPDATE OR DELETE ON public.leases FOR EACH ROW EXECUTE FUNCTION public.audit_row();
DROP TRIGGER IF EXISTS audit_maintenance ON public.maintenance_requests;
CREATE TRIGGER audit_maintenance AFTER INSERT OR UPDATE OR DELETE ON public.maintenance_requests FOR EACH ROW EXECUTE FUNCTION public.audit_row();
DROP TRIGGER IF EXISTS audit_units ON public.units;
CREATE TRIGGER audit_units AFTER INSERT OR UPDATE OR DELETE ON public.units FOR EACH ROW EXECUTE FUNCTION public.audit_row();
DROP TRIGGER IF EXISTS audit_expenses ON public.expenses;
CREATE TRIGGER audit_expenses AFTER INSERT OR UPDATE OR DELETE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.audit_row();
DROP TRIGGER IF EXISTS audit_deals ON public.deals;
CREATE TRIGGER audit_deals AFTER INSERT OR UPDATE OR DELETE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.audit_row();

-- 7) التذكير الذكي التلقائي (قبل الاستحقاق بـ 7 و3 أيام ويوم الاستحقاق)
CREATE OR REPLACE FUNCTION public.smart_payment_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c int := 0; d int; already boolean; r record;
BEGIN
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
END $$;
REVOKE EXECUTE ON FUNCTION public.smart_payment_reminders() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.smart_payment_reminders() TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'smart-payment-reminders') THEN
    PERFORM cron.schedule('smart-payment-reminders', '0 8 * * *', 'SELECT public.smart_payment_reminders()');
  END IF;
END $$;