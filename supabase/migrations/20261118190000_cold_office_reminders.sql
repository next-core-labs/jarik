-- تذكير تلقائي للمكاتب التي سجّلت ولم تُدخل عقاراتها (أو أدخلت عقارًا بلا وحدات).
--
-- السياق: لوحة التفعيل (20261118180000) تُظهر أن أكثر ما يوقف النشر ليس عقبة تقنية بل أن المكتب
-- لم يبدأ. فبدل انتظار متابعة بشرية لكل مكتب، تُذكّره المنصة تلقائيًا ثلاث مرات ثم تتوقف.
--
-- القناة: إشعار داخلي. الواتساب مقفول بانتظار مفاتيح المزوّد، والبريد يُرسَل من خادم التطبيق
-- (sendViaResend) ولا يملك Postgres هنا pg_net ليستدعيه، ولا يوجد cron في Cloudflare. فالإشعار
-- الداخلي هو القناة المتاحة فعلًا، وهو نفس نمط smart_payment_reminders القائم.
--
-- التدرّج: بعد 3 أيام، ثم 7، ثم 14 — ثلاث مرات كحد أقصى لكل مكتب، ثم صمت. والشرط «عدد ما أُرسل»
-- لا «اليوم بالضبط»، فانقطاع الـcron يومًا لا يُفقد التذكير بل يؤجّله.
--
-- يتوقف تلقائيًا متى أضاف المكتب أول وحدة (شرط has_units أدناه)، فلا تذكير لمن بدأ فعلًا.

CREATE OR REPLACE FUNCTION public.notify_cold_offices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  sent integer := 0;
  stage integer;
  v_title text;
  v_body text;
BEGIN
  -- نفس حارس smart_payment_reminders: الخادم والـcron (بلا auth.uid()) يمرّان، والمستخدم لا.
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
    -- من أضاف وحدة واحدة فقد بدأ: لا تذكير له (ولوحة التفعيل تتابعه بعقبة أخرى).
    CONTINUE WHEN r.has_units;

    -- المرحلة التالية المستحقّة، بحسب ما أُرسل لا بحسب تاريخ اليوم — مقاوم لانقطاع الـcron.
    stage := CASE
      WHEN r.reminders = 0 AND r.age_days >= 3  THEN 1
      WHEN r.reminders = 1 AND r.age_days >= 7  THEN 2
      WHEN r.reminders = 2 AND r.age_days >= 14 THEN 3
      ELSE 0
    END;
    CONTINUE WHEN stage = 0;

    -- الرسالة تخاطب موضع التوقف فعلًا: بلا عقار أصلًا، أو عقار بلا وحدات.
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

    -- إلى مديري المكتب تحديدًا: هم من يُدخل العقارات، لا كل الموظفين.
    INSERT INTO public.notifications
      (user_id, org_id, title, body, kind, source, related_table, related_id)
    SELECT m.user_id, r.id, v_title, v_body, 'office_activation', 'system', 'org_settings', r.id
    FROM public.org_members m
    WHERE m.org_id = r.id AND m.kind = 'member' AND m.is_manager;

    -- مكتب بلا مدير مسجَّل لا يستقبل شيئًا؛ لا نحسبه مذكَّرًا كي لا يُستهلك تدرّجه بلا فائدة.
    IF FOUND THEN sent := sent + 1; END IF;
  END LOOP;

  RETURN sent;
END $$;
REVOKE ALL ON FUNCTION public.notify_cold_offices() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cold-office-reminders') THEN
    -- 06:30 UTC = 09:30 بتوقيت الرياض، بعيدًا عن وظائف الصباح الأخرى.
    PERFORM cron.schedule('cold-office-reminders', '30 6 * * *',
      'SELECT public.notify_cold_offices()');
  END IF;
END $$;

-- ── لوحة التفعيل ترى ما أُرسل: فلا يتّصل فريق المنصة بمكتب ذُكّر تلقائيًا للتو ───────────────────
-- نفس تعريف 20261118180000 + عمودَي التذكير في النهاية.
-- CREATE OR REPLACE لا يقبل تغيير نوع الإرجاع (إضافة أعمدة OUT) — فتُحذف الدالتان أولًا. العامة
-- قبل الخاصة لأنها تستدعيها، والواجهة تقرأ العامة فقط فلا شيء يراها محذوفة خارج هذه الدفعة.
DROP FUNCTION IF EXISTS public.hq_office_activation();
DROP FUNCTION IF EXISTS private.office_activation_rows();

CREATE OR REPLACE FUNCTION private.office_activation_rows()
RETURNS TABLE (
  id uuid, company_name text, created_at timestamptz,
  manager_email text, office_phone text, whatsapp_number text, city text, district text,
  fal_license_no text, verified boolean, listed_publicly boolean,
  units bigint, vacant bigint, vacant_priced bigint, listed bigint,
  live bigint, live_with_photos bigint,
  blocker text, priority integer,
  reminders_sent bigint, last_reminder_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH office_units AS (
    SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id)) AS org_id,
      u.status,
      u.market_listed,
      CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END AS price
    FROM public.units u
    JOIN public.properties p ON p.id = u.property_id
  ),
  agg AS (
    SELECT org_id,
      count(*) AS units,
      count(*) FILTER (WHERE status = 'vacant') AS vacant,
      count(*) FILTER (WHERE status = 'vacant' AND COALESCE(price, 0) > 0) AS vacant_priced,
      count(*) FILTER (WHERE status = 'vacant' AND market_listed) AS listed
    FROM office_units
    WHERE org_id IS NOT NULL
    GROUP BY org_id
  ),
  live_now AS (
    SELECT v.office_id AS org_id,
      count(*) AS live,
      count(*) FILTER (WHERE COALESCE(v.photos_count, 0) > 0) AS live_with_photos
    FROM public.vacant_units_public v
    WHERE v.office_id IS NOT NULL
    GROUP BY v.office_id
  ),
  nudges AS (
    SELECT n.org_id, count(*) AS reminders_sent, max(n.created_at) AS last_reminder_at
    FROM public.notifications n
    WHERE n.kind = 'office_activation' AND n.org_id IS NOT NULL
    GROUP BY n.org_id
  ),
  base AS (
    SELECT o.id, o.company_name, o.created_at,
      (SELECT au.email::text FROM auth.users au
       JOIN public.org_members m ON m.user_id = au.id
       WHERE m.org_id = o.id AND m.is_manager LIMIT 1) AS manager_email,
      o.office_phone, o.whatsapp_number, o.city, o.district,
      o.fal_license_no, o.verified, o.listed_publicly,
      COALESCE(a.units, 0) AS units,
      COALESCE(a.vacant, 0) AS vacant,
      COALESCE(a.vacant_priced, 0) AS vacant_priced,
      COALESCE(a.listed, 0) AS listed,
      COALESCE(l.live, 0) AS live,
      COALESCE(l.live_with_photos, 0) AS live_with_photos,
      CASE
        WHEN COALESCE(l.live, 0) > 0 THEN NULL
        WHEN COALESCE(a.units, 0) = 0 THEN 'no_units'
        WHEN COALESCE(a.vacant, 0) = 0 THEN 'all_occupied'
        WHEN COALESCE(a.vacant_priced, 0) = 0 THEN 'no_price'
        WHEN NOT o.verified THEN 'not_verified'
        WHEN NOT o.listed_publicly THEN 'not_listed'
        WHEN COALESCE(a.listed, 0) = 0 THEN 'not_published'
        ELSE 'other'
      END AS blocker,
      -- التذكيرات تُحتسب لكل المكتب، ومديروه قد يكونون أكثر من واحد، فالعدد = عدد الدفعات لا الصفوف.
      COALESCE(nu.reminders_sent, 0) AS reminders_sent,
      nu.last_reminder_at
    FROM public.org_settings o
    LEFT JOIN agg a ON a.org_id = o.id
    LEFT JOIN live_now l ON l.org_id = o.id
    LEFT JOIN nudges nu ON nu.org_id = o.id
  )
  SELECT b.id, b.company_name, b.created_at, b.manager_email, b.office_phone, b.whatsapp_number,
    b.city, b.district, b.fal_license_no, b.verified, b.listed_publicly,
    b.units, b.vacant, b.vacant_priced, b.listed, b.live, b.live_with_photos, b.blocker,
    CASE b.blocker
      WHEN 'not_verified'  THEN 1
      WHEN 'not_listed'    THEN 2
      WHEN 'not_published' THEN 3
      WHEN 'no_price'      THEN 4
      WHEN 'no_units'      THEN 5
      WHEN 'all_occupied'  THEN 6
      WHEN 'other'         THEN 7
      ELSE 9
    END::integer AS priority,
    b.reminders_sent, b.last_reminder_at
  FROM base b
  ORDER BY priority, b.created_at DESC
$$;
REVOKE ALL ON FUNCTION private.office_activation_rows() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.hq_office_activation()
RETURNS TABLE (
  id uuid, company_name text, created_at timestamptz,
  manager_email text, office_phone text, whatsapp_number text, city text, district text,
  fal_license_no text, verified boolean, listed_publicly boolean,
  units bigint, vacant bigint, vacant_priced bigint, listed bigint,
  live bigint, live_with_photos bigint,
  blocker text, priority integer,
  reminders_sent bigint, last_reminder_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_hq_offices(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.office_activation_rows();
END $$;
REVOKE ALL ON FUNCTION public.hq_office_activation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_office_activation() TO authenticated;

-- ── التحقق: تنفيذ كامل بلا إرسال ────────────────────────────────────────────────────────────────
-- استعلامات جسم plpgsql لا تُفحص إلا عند التنفيذ، فدالة cron معطوبة تصمت في السجلّ ولا يلاحظها
-- أحد. لذا تُشغَّل هنا فعلًا — لكن داخل بلوك له EXCEPTION، وهو معاملة فرعية، فرفع استثناء في
-- نهايته يُرجع كل ما أدرجته. النتيجة: الاستعلام والإدراج مُثبَتان، ولا يُرسَل تذكير واحد لمكتب
-- حقيقي بسبب دفعة قاعدة بيانات. أول إرسال حقيقي يكون من الـcron في 09:30 بتوقيت الرياض.
DO $$
DECLARE rows_n integer := 0; n integer; r record;
BEGIN
  FOR r IN SELECT * FROM private.office_activation_rows() LOOP
    rows_n := rows_n + 1;
  END LOOP;
  IF rows_n = 0 THEN
    RAISE EXCEPTION 'لوحة التفعيل لا تُرجع أي مكتب — راجع الاستعلام';
  END IF;
  RAISE NOTICE 'activation rows OK: %', rows_n;

  -- بلوك له EXCEPTION = معاملة فرعية: الاستثناء في نهايته يُرجع إدراجات التجربة وحدها.
  BEGIN
    SELECT public.notify_cold_offices() INTO n;
    RAISE EXCEPTION 'probe_rollback:%', n;
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'probe_rollback:%' THEN
      RAISE NOTICE 'notify_cold_offices OK — would notify % office(s) on the next cron run',
        substring(SQLERRM from 16);
    ELSE
      RAISE;  -- خطأ حقيقي (عمود ناقص، جدول مفقود…): يُسقط الدفعة
    END IF;
  END;
END $$;
