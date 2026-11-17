-- تدقيق ما بُني في 20261118210000، وإتاحة تجربته من اللوحة.
--
-- السبب: مهمة cron لا تُرسل بريدًا لو لم تُجدَّل (غياب pg_net) — وهذا يفشل بصمت تمامًا كما حذّرنا.
-- فهذه الـmigration تُسقط نفسها إن لم تكن المهمة قائمة فعلًا، فيُعرف الخلل الآن لا بعد أسبوع.

-- ── 1. إذن «offices» للمتصل نفسه — يحتاجه زر «أرسل الآن» في /hq ─────────────────────────────────
-- private.is_hq_offices موجودة لكنها خاصة؛ هذا غلاف عام يسأل عن المتصل وحده ولا يقبل معرّف غيره.
CREATE OR REPLACE FUNCTION public.is_hq_offices_me()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT private.is_hq_offices(auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_hq_offices_me() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_hq_offices_me() TO authenticated;

-- ── 2. تدقيق: pg_net والمهمة المجدولة ───────────────────────────────────────────────────────────
DO $$
DECLARE _sched text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION
      'pg_net غير مثبَّت — مهمة بريد التذكيرات لن ترسل شيئًا. ثبّته من Supabase (Database → Extensions) ثم أعد تشغيل 20261118210000.';
  END IF;

  SELECT schedule INTO _sched FROM cron.job WHERE jobname = 'office-reminder-emails';
  IF _sched IS NULL THEN
    RAISE EXCEPTION 'مهمة office-reminder-emails غير مجدولة — راجع 20261118210000.';
  END IF;
  RAISE NOTICE 'office-reminder-emails scheduled at %', _sched;

  -- السرّ موجود وطويل بما يكفي ليُرفض تخمينه.
  IF NOT EXISTS (
    SELECT 1 FROM private.app_config WHERE key = 'cron_secret' AND length(value) >= 32
  ) THEN
    RAISE EXCEPTION 'سرّ الـcron مفقود أو قصير — راجع 20261118210000.';
  END IF;

  -- نصّ المهمة يحمل السرّ الصحيح: لو تغيّر السرّ بعد الجدولة لصارت المهمة تُنادي بسرّ قديم فتُرفض.
  IF NOT EXISTS (
    SELECT 1 FROM cron.job j
    JOIN private.app_config c ON c.key = 'cron_secret'
    WHERE j.jobname = 'office-reminder-emails' AND j.command LIKE '%' || c.value || '%'
  ) THEN
    RAISE EXCEPTION 'نصّ مهمة البريد لا يحمل السرّ الحالي — أعد جدولتها.';
  END IF;

  RAISE NOTICE 'reminder email pipeline OK';
END $$;
