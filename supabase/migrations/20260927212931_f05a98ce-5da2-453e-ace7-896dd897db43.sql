-- المرحلة D من توسيع لوحة "المدير العام" (/hq): إعدادات المنصة العامة (تسجيل مكاتب جديدة + بانر
-- إعلان) وصحة المهام المجدولة (pg_cron) — كلها بصلاحية "system" (أُضيفت بالمرحلة B مسبقًا).

-- صف واحد ثابت (id boolean PK CHECK true) بدل جدول متعدد الصفوف — لا حاجة لأكثر من إعدادات منصة
-- واحدة. قراءة عامة (لا بيانات حساسة: مفتاح تشغيل ونص بانر فقط)، الكتابة فقط عبر الدالة أدناه.
CREATE TABLE public.platform_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  new_office_registration_enabled boolean NOT NULL DEFAULT true,
  announcement_banner text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.platform_settings (id) VALUES (true);
GRANT SELECT ON public.platform_settings TO anon, authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT TO anon, authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.hq_update_platform_settings(
  _new_office_registration_enabled boolean, _announcement_banner text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'system' = ANY(permissions)
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.platform_settings SET
    new_office_registration_enabled = COALESCE(_new_office_registration_enabled, true),
    announcement_banner = nullif(trim(COALESCE(_announcement_banner, '')), ''),
    updated_at = now()
  WHERE id = true;
END $$;
REVOKE ALL ON FUNCTION public.hq_update_platform_settings(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_update_platform_settings(boolean, text) TO authenticated;

-- نفس تعريف register_office الحالي (20260924000526) + حارس تسجيل مكاتب جديدة واحد أول الدالة.
CREATE OR REPLACE FUNCTION public.register_office(_name text, _city text, _district text, _fal text, _phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _code text;
BEGIN
  IF NOT (SELECT new_office_registration_enabled FROM public.platform_settings WHERE id = true) THEN
    RAISE EXCEPTION 'تسجيل مكاتب جديدة موقوف مؤقتًا';
  END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF public.my_org_id() IS NOT NULL THEN RAISE EXCEPTION 'حسابك تابع لمكتب بالفعل'; END IF;
  IF length(trim(_name)) < 3 THEN RAISE EXCEPTION 'اسم المكتب قصير'; END IF;
  _code := upper(substr(regexp_replace(COALESCE(nullif(trim(_name),''), 'OFFICE'), '[^A-Za-z0-9]', '', 'g'), 1, 8));
  IF _code = '' THEN _code := 'OFFICE'; END IF;
  WHILE EXISTS (SELECT 1 FROM public.org_settings WHERE office_code = _code) LOOP
    _code := _code || floor(random() * 90 + 10)::text;
  END LOOP;
  INSERT INTO public.org_settings (company_name, city, district, fal_license_no, office_phone, office_code, listed_publicly, verified)
  VALUES (trim(_name), nullif(trim(_city),''), nullif(trim(_district),''), nullif(trim(_fal),''), nullif(trim(_phone),''), _code, true, false)
  RETURNING id INTO _org;
  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (_org, auth.uid(), 'member', 'staff', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'staff')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.register_office(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_office(text, text, text, text, text) TO authenticated;

-- صحة المهام المجدولة: سجل بسيط لآخر تشغيل ناجح لكل مهمة. لا يُسجَّل صف عند استثناء يُفشل الدالة
-- بالكامل (المعاملة كلها تتراجع) — "آخر تشغيل ناجح قديم جدًا" إشارة صحية كافية هنا، بدل آلية
-- تسجيل فشل معقّدة. قراءة عبر service-role فقط (تُستدعى من دالة خادم بصلاحية "system").
CREATE TABLE public.cron_job_runs (
  id bigserial PRIMARY KEY,
  job_name text NOT NULL,
  ran_at timestamptz NOT NULL DEFAULT now(),
  rows_affected integer
);
CREATE INDEX cron_job_runs_job_ran_idx ON public.cron_job_runs (job_name, ran_at DESC);
GRANT ALL ON public.cron_job_runs TO service_role;
ALTER TABLE public.cron_job_runs ENABLE ROW LEVEL SECURITY;
-- عمدًا بلا أي سياسة لـauthenticated/anon — الوصول فقط عبر service-role من دالة خادم.

-- نفس تعريف decay_vacant_unit_prices الحالي (20260926030611) + سطر تسجيل واحد قبل RETURN.
CREATE OR REPLACE FUNCTION public.decay_vacant_unit_prices() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  new_price numeric;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id, listing_purpose, annual_rent, sale_price, price_floor
    FROM public.units
    WHERE status = 'vacant' AND market_listed AND auto_price_decay
      AND price_floor IS NOT NULL
      AND vacant_since IS NOT NULL AND vacant_since <= now() - interval '14 days'
      AND (price_decayed_at IS NULL OR price_decayed_at <= now() - interval '7 days')
  LOOP
    IF r.listing_purpose = 'sale' THEN
      new_price := greatest(r.price_floor, round(r.sale_price * 0.98));
      IF new_price < r.sale_price THEN
        UPDATE public.units SET sale_price = new_price, price_decayed_at = now() WHERE id = r.id;
        PERFORM public.notify_unit(r.id, 'خُفِّض سعر وحدتك تلقائيًا',
          'انخفض سعر البيع إلى ' || to_char(new_price, 'FM999999999') || ' ريال لطول فترة العرض بلا اهتمام كافٍ.', 'unit');
        n := n + 1;
      END IF;
    ELSE
      new_price := greatest(r.price_floor, round(r.annual_rent * 0.98));
      IF new_price < r.annual_rent THEN
        UPDATE public.units SET annual_rent = new_price, price_decayed_at = now() WHERE id = r.id;
        PERFORM public.notify_unit(r.id, 'خُفِّض إيجار وحدتك تلقائيًا',
          'انخفض الإيجار السنوي إلى ' || to_char(new_price, 'FM999999999') || ' ريال لطول فترة العرض بلا اهتمام كافٍ.', 'unit');
        n := n + 1;
      END IF;
    END IF;
  END LOOP;
  INSERT INTO public.cron_job_runs (job_name, rows_affected) VALUES ('vacant-price-decay', n);
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.decay_vacant_unit_prices() FROM PUBLIC, anon, authenticated;

-- نفس تعريف smart_payment_reminders الحالي (20260922090000، آخر نسخة منه) + سطر تسجيل واحد قبل RETURN.
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
  -- Only the unattended cron run (no auth.uid()) logs to cron_job_runs — a staff member clicking
  -- the manual "remind now" button in the app calls this same function with their own session, and
  -- that isn't a scheduled-job execution the health tab should report on.
  IF auth.uid() IS NULL THEN
    INSERT INTO public.cron_job_runs (job_name, rows_affected) VALUES ('smart-payment-reminders', c);
  END IF;
  RETURN c;
END $$;
REVOKE EXECUTE ON FUNCTION public.smart_payment_reminders() FROM anon;