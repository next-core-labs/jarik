-- إيصال تذكيرات التفعيل بالبريد، لا بالإشعار الداخلي وحده.
--
-- المشكلة: notify_cold_offices (20261118190000) يُنشئ إشعارًا داخليًا، وهو يقتضي أن يفتح صاحب
-- المكتب المنصة ليراه — وهو بالضبط ما لا يفعله المكتب الذي سجّل ولم يُدخل عقاراته. فالتذكير لا يصل.
--
-- التصميم: صندوق صادر (transactional outbox). القرار (من يُذكَّر، في أي مرحلة، بأي نص) يبقى في
-- notify_cold_offices وحده — مكان واحد، مُختبَر. وهو يُضيف إلى الصندوق سطرًا لكل بريد مستحق.
-- ثم مهمة cron ثانية تطلب من خادم التطبيق تصريفه عبر Resend، وتسجّل نتيجة كل سطر. فوائد ذلك:
--   • الإرسال قابل لإعادة المحاولة: فشل مزوّد البريد لا يُفقد التذكير ولا يستهلك مرحلته.
--   • مرئي: الفشل سطر في جدول لا خطأ في سجلّ cron لا يقرؤه أحد.
--   • الإشعار الداخلي يبقى كما هو — البريد قناة إضافية لا بديل.
--
-- السرّ: يُولَّد هنا عشوائيًا ويبقى في القاعدة. مهمة cron تقرؤه لترسله في ترويسة، والخادم يتحقّق
-- منه عبر دالة لا تُعيده أبدًا. فلا سرّ في git، ولا خطوة إعداد على المستخدم، ومن يملك مفتاح الخدمة
-- يملك القاعدة كلها أصلًا فلا تعرُّض جديد.

-- ── 1. إعدادات داخلية (سرّ الـcron) ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS private.app_config (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON private.app_config FROM PUBLIC, anon, authenticated;

-- يُولَّد مرة واحدة؛ إعادة تشغيل الـmigration لا تغيّره (وإلا توقّفت المهمة المجدولة).
INSERT INTO private.app_config (key, value)
VALUES ('cron_secret', gen_random_uuid()::text)
ON CONFLICT (key) DO NOTHING;

-- التحقّق فقط، بلا إعادة القيمة — فلو سُرّب مفتاح الخدمة لا يُسرَّب السرّ من هذا الطريق.
CREATE OR REPLACE FUNCTION public.cron_secret_valid(_secret text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM private.app_config
    WHERE key = 'cron_secret' AND value = _secret AND length(_secret) >= 16
  )
$$;
REVOKE ALL ON FUNCTION public.cron_secret_valid(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_secret_valid(text) TO service_role;

-- ── 2. الصندوق الصادر ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.office_reminder_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE,
  /** مرحلة التذكير 1..3 — نفس تدرّج notify_cold_offices. */
  stage smallint NOT NULL CHECK (stage BETWEEN 1 AND 3),
  to_email text NOT NULL CHECK (position('@' in to_email) > 1),
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts smallint NOT NULL DEFAULT 0,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS office_reminder_emails_pending_idx
  ON public.office_reminder_emails (created_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS office_reminder_emails_org_idx
  ON public.office_reminder_emails (org_id, created_at DESC);

ALTER TABLE public.office_reminder_emails ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.office_reminder_emails FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.office_reminder_emails TO authenticated;
GRANT ALL ON public.office_reminder_emails TO service_role;

-- يقرؤه فريق المنصة فقط (يحمل بريد المدير): لوحة التفعيل تعرض ما وصل وما فشل.
DROP POLICY IF EXISTS office_reminder_emails_hq ON public.office_reminder_emails;
CREATE POLICY office_reminder_emails_hq ON public.office_reminder_emails
  FOR SELECT TO authenticated
  USING (private.is_hq_offices(auth.uid()));

-- ── 3. القرار يبقى في مكان واحد: notify_cold_offices يُضيف إلى الصندوق كذلك ─────────────────────
-- مبني على 20261118190000 بنفس المنطق والنصوص، بإضافة بريد المدير إلى الصندوق.
CREATE OR REPLACE FUNCTION public.notify_cold_offices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  sent integer := 0;
  stage integer;
  v_title text;
  v_body text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  FOR r IN
    SELECT o.id, o.company_name,
      (now()::date - o.created_at::date) AS age_days,
      EXISTS (SELECT 1 FROM public.properties p WHERE p.org_id = o.id) AS has_properties,
      EXISTS (
        SELECT 1 FROM public.units u
        JOIN public.properties p ON p.id = u.property_id
        WHERE p.org_id = o.id
      ) AS has_units,
      (SELECT count(*) FROM public.notifications n
       WHERE n.org_id = o.id AND n.kind = 'office_activation') AS reminders
    FROM public.org_settings o
  LOOP
    CONTINUE WHEN r.has_units;

    stage := CASE
      WHEN r.reminders = 0 AND r.age_days >= 3  THEN 1
      WHEN r.reminders = 1 AND r.age_days >= 7  THEN 2
      WHEN r.reminders = 2 AND r.age_days >= 14 THEN 3
      ELSE 0
    END;
    CONTINUE WHEN stage = 0;

    IF NOT r.has_properties THEN
      v_title := CASE stage
        WHEN 1 THEN 'أضف أول عقار لتبدأ'
        WHEN 2 THEN 'عقاراتك لم تُسجّل بعد'
        ELSE 'تذكير أخير: سجّل عقاراتك'
      END;
      v_body := CASE stage
        WHEN 1 THEN 'مكتبك مسجّل في جارك، ولم تُسجّل أي عقار بعد. أضف عقارك الأول من «الأملاك والوحدات» لتبدأ إدارة العقود والتحصيل ونشر عروضك في السوق.'
        WHEN 2 THEN 'مرّ أسبوع على تسجيل مكتبك دون أي عقار. تسجيل عقار واحد يكفي لتجربة المنصة: العقود والدفعات والصيانة وعرض الوحدات الشاغرة على الزوار.'
        ELSE 'هذا تذكيرنا الأخير — لن نرسل غيره. متى أضفت عقارك الأول من «الأملاك والوحدات» تعمل المنصة بكاملها معك، وإن احتجت مساعدة في الإدخال تواصل معنا.'
      END;
    ELSE
      v_title := CASE stage
        WHEN 1 THEN 'أضف وحدات عقارك'
        WHEN 2 THEN 'عقارك بلا وحدات بعد'
        ELSE 'تذكير أخير: أضف وحدات عقارك'
      END;
      v_body := CASE stage
        WHEN 1 THEN 'سجّلت عقارك ولم تُضف وحداته بعد. أضف الوحدات من صفحة العقار لتتمكّن من تسجيل العقود والتحصيل ونشر الشاغر في السوق.'
        WHEN 2 THEN 'مرّ أسبوع وعقارك بلا وحدات. يمكنك إضافة عدة وحدات مرة واحدة بزر «إضافة وحدات بالجملة» إن كانت متشابهة.'
        ELSE 'هذا تذكيرنا الأخير — لن نرسل غيره. أضف وحدات عقارك من صفحة العقار، وإن احتجت مساعدة في الإدخال تواصل معنا.'
      END;
    END IF;

    INSERT INTO public.notifications
      (user_id, org_id, title, body, kind, source, related_table, related_id)
    SELECT m.user_id, r.id, v_title, v_body, 'office_activation', 'system', 'org_settings', r.id
    FROM public.org_members m
    WHERE m.org_id = r.id AND m.kind = 'member' AND m.is_manager;

    IF FOUND THEN
      sent := sent + 1;

      -- البريد: سطر واحد لكل مدير له بريد مؤكَّد. الإشعار الداخلي هو عدّاد المرحلة، والبريد
      -- قناة إضافية — فلو تعذّر الإرسال لا تُستهلك المرحلة مرتين ولا يُعاد الإشعار.
      INSERT INTO public.office_reminder_emails (org_id, stage, to_email, subject, body)
      SELECT r.id, stage, au.email,
        v_title || ' — ' || COALESCE(r.company_name, 'جارك'),
        v_body
      FROM public.org_members m
      JOIN auth.users au ON au.id = m.user_id
      WHERE m.org_id = r.id AND m.kind = 'member' AND m.is_manager
        AND au.email IS NOT NULL
        AND au.email_confirmed_at IS NOT NULL;
    END IF;
  END LOOP;

  RETURN sent;
END $$;
REVOKE ALL ON FUNCTION public.notify_cold_offices() FROM PUBLIC, anon, authenticated;

-- ── 4. ما يصرّفه الخادم، وكيف يُسجّل النتيجة ────────────────────────────────────────────────────
-- 3 محاولات كحد أقصى لكل سطر، فمزوّد بريد معطوب لا يُعيد المحاولة إلى الأبد.
CREATE OR REPLACE FUNCTION public.pending_reminder_emails(_limit integer DEFAULT 50)
RETURNS TABLE (id uuid, to_email text, subject text, body text, stage smallint, company_name text)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.to_email, e.subject, e.body, e.stage, o.company_name
  FROM public.office_reminder_emails e
  LEFT JOIN public.org_settings o ON o.id = e.org_id
  WHERE e.status = 'pending' AND e.attempts < 3
  ORDER BY e.created_at
  LIMIT greatest(1, least(_limit, 200))
$$;
REVOKE ALL ON FUNCTION public.pending_reminder_emails(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pending_reminder_emails(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.mark_reminder_email(_id uuid, _ok boolean, _error text DEFAULT NULL)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.office_reminder_emails
  SET attempts = attempts + 1,
      status = CASE WHEN _ok THEN 'sent'
                    -- يبقى pending ليُعاد غدًا، حتى تُستنفد المحاولات الثلاث.
                    WHEN attempts + 1 >= 3 THEN 'failed'
                    ELSE 'pending' END,
      sent_at = CASE WHEN _ok THEN now() ELSE sent_at END,
      error = CASE WHEN _ok THEN NULL ELSE left(COALESCE(_error, 'unknown'), 500) END
  WHERE id = _id
$$;
REVOKE ALL ON FUNCTION public.mark_reminder_email(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_reminder_email(uuid, boolean, text) TO service_role;

-- ── 5. جدولة التصريف: القاعدة تطلب من خادم التطبيق أن يرسل ──────────────────────────────────────
-- Postgres لا يرسل بريدًا، والمفتاح وقوالب البريد في خادم التطبيق — فتُستدعى نقطة محمية بالسرّ.
-- pg_net هو امتداد Supabase القياسي؛ لو غاب تبقى بقية الـmigration عاملة ويُنبَّه بذلك.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_net';
    RAISE NOTICE 'pg_net ready';
  ELSE
    RAISE WARNING 'pg_net غير متاح — لم تُجدَّل مهمة البريد؛ ناد النقطة من مجدول خارجي';
  END IF;
END $$;

DO $$
DECLARE _secret text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN RETURN; END IF;
  SELECT value INTO _secret FROM private.app_config WHERE key = 'cron_secret';
  IF _secret IS NULL THEN RETURN; END IF;

  PERFORM cron.unschedule('office-reminder-emails')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'office-reminder-emails');

  -- 06:40 UTC = 09:40 بالرياض، عشر دقائق بعد notify_cold_offices فيجد صندوقها ممتلئًا.
  -- السرّ يُحقن في نص المهمة هنا (داخل القاعدة لا في git)، لأن cron.schedule لا يأخذ معاملات.
  PERFORM cron.schedule('office-reminder-emails', '40 6 * * *', format(
    $job$SELECT net.http_post(
      url := 'https://jarak-ksa.com/api/public/cron/office-reminders',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', %L),
      body := '{}'::jsonb,
      timeout_milliseconds := 25000
    )$job$, _secret));
END $$;

-- ── 6. التحقق: تنفيذ فعلي للدوال الثلاث بلا أثر ─────────────────────────────────────────────────
DO $$
DECLARE n integer; cnt integer; ok boolean;
BEGIN
  -- التحقّق من السرّ: القيمة الصحيحة تُقبل، وغيرها يُرفض.
  SELECT public.cron_secret_valid(value) INTO ok FROM private.app_config WHERE key = 'cron_secret';
  IF NOT ok THEN RAISE EXCEPTION 'probe_failed: السرّ الصحيح لم يُقبل'; END IF;
  IF public.cron_secret_valid('wrong-secret-value-xxxxx') THEN
    RAISE EXCEPTION 'probe_failed: سرّ خاطئ قُبل';
  END IF;

  SELECT count(*) INTO cnt FROM public.pending_reminder_emails(10);
  RAISE NOTICE 'pending_reminder_emails OK (% rows now)', cnt;

  BEGIN
    SELECT public.notify_cold_offices() INTO n;
    SELECT count(*) INTO cnt FROM public.office_reminder_emails WHERE status = 'pending';
    RAISE EXCEPTION 'probe_rollback:% offices, % queued emails', n, cnt;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'probe_rollback:%' THEN
      RAISE NOTICE 'notify_cold_offices + outbox OK — %', substring(SQLERRM from 17);
    ELSE
      RAISE;
    END IF;
  END;
END $$;
