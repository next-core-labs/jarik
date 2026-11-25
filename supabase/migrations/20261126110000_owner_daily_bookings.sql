-- لوحة الحجز اليومي للمالك: يرى حجوزات وحداته ويحجب أيامه لاستخدامه الخاص.
--
-- اليوم لا يرى المالك من الحجز اليومي شيئًا: سياسات bookings وunit_booking_settings كلها
-- can_manage_org (موظف عضو في المكتب)، فشاليه المالك يُحجز ويُؤجَّر بالليلة وهو لا يعرف متى يأتي
-- ضيف ولا كم ليلة بيعت، ولا يستطيع أن يقول «هذا الأسبوع لي» إلا بمكالمة للمكتب.
--
-- ما يُسمح به هنا وما لا يُسمح، ولماذا:
--   • قراءة: كل حجز على وحدة يملكها — الحجز على ملكه، ومعرفته بما يجري فيه أصل لا منّة.
--   • حجب: يُدخل صفًّا بحالة 'blocked' على وحدته فقط، بلا بيانات ضيف وبلا مبلغ. قيد EXCLUDE هو
--     من يفصل عند التزاحم، فحجب المالك فوق حجز قائم يُرفض في القاعدة لا في الواجهة.
--   • رفع الحجب: يُلغي حجبًا قائمًا على وحدته (حجبه أو حجب المكتب) — الصفّ المُحدَّث يبقى
--     'blocked' أو يصير 'cancelled'، لا غير.
--   • لا يؤكّد حجز ضيف ولا يرفضه: الوحدة تُعرض وتُدار باتفاقية إدارة، والتعاقد مع الضيف فعل
--     المكتب. السياسة أدناه تمنعه من لمس صفّ ليس حجبًا، لا بالواجهة بل في القاعدة.
--   • لا ينشر إعلانًا ولا يسعّره: النشر محجوب على المالك أصلًا (guard_owner_unit_write)، فقراءة
--     إعدادات الحجز تكفيه ليرى سعر الليلة ورخصة الإيواء وأقل مدة على وحدته.
--
-- unit_id لا يتغيّر في التحديث (a0_fill_booking_org يعيده إلى OLD)، فلا ينقل أحد حجبًا إلى وحدة
-- غيره. وسياسات RLS تُجمَع بـOR، فهذه تُضاف إلى سياسات المكتب ولا تنقص منها شيئًا.

-- ── 1. حجوزات وحدات المالك ──────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS bookings_owner_read ON public.bookings;
CREATE POLICY bookings_owner_read ON public.bookings FOR SELECT TO authenticated
  USING (private.unit_owner(unit_id) = auth.uid());

DROP POLICY IF EXISTS bookings_owner_block ON public.bookings;
CREATE POLICY bookings_owner_block ON public.bookings FOR INSERT TO authenticated
  WITH CHECK (
    status = 'blocked'
    AND private.unit_owner(unit_id) = auth.uid()
    AND public.has_role(auth.uid(), 'owner')
    -- حجب لا حجز: لا ضيف ولا مبلغ على اسم المالك.
    AND guest_name IS NULL AND guest_phone IS NULL AND guest_user_id IS NULL
    AND total_amount = 0
  );

DROP POLICY IF EXISTS bookings_owner_release ON public.bookings;
CREATE POLICY bookings_owner_release ON public.bookings FOR UPDATE TO authenticated
  USING (
    status = 'blocked'
    AND private.unit_owner(unit_id) = auth.uid()
    AND public.has_role(auth.uid(), 'owner')
  )
  WITH CHECK (
    status IN ('blocked', 'cancelled')
    AND private.unit_owner(unit_id) = auth.uid()
    AND guest_name IS NULL AND guest_phone IS NULL AND guest_user_id IS NULL
  );

-- ── 2. إعدادات الحجز اليومي: قراءة فقط لمالك الوحدة ─────────────────────────────────────────────
DROP POLICY IF EXISTS unit_booking_settings_owner_read ON public.unit_booking_settings;
CREATE POLICY unit_booking_settings_owner_read ON public.unit_booking_settings
  FOR SELECT TO authenticated
  USING (private.unit_owner(unit_id) = auth.uid());

-- ── 3. تحقّق بلا أي كتابة ───────────────────────────────────────────────────────────────────────
-- (الفحص بإدخال صفوف تجريبية مرفوض عمدًا: جدول حجوزات حقيقي في الإنتاج.)
DO $$
DECLARE _missing text; _def text;
BEGIN
  SELECT string_agg(p, '، ') INTO _missing
  FROM unnest(ARRAY['bookings_owner_read', 'bookings_owner_block', 'bookings_owner_release',
                    'unit_booking_settings_owner_read']) AS p
  WHERE NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname = p);
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'سياسات المالك لم تُنشأ: %', _missing;
  END IF;

  -- سياسة المكتب تبقى كما هي: هذه إضافة لا استبدال.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'bookings' AND policyname = 'bookings_office'
  ) THEN
    RAISE EXCEPTION 'تراجع: سياسة bookings_office اختفت';
  END IF;

  -- الحجب وحده قابل للتعديل من المالك: شرط USING يذكر blocked صراحة.
  SELECT qual INTO _def FROM pg_policies
  WHERE schemaname = 'public' AND tablename = 'bookings' AND policyname = 'bookings_owner_release';
  IF _def NOT LIKE '%blocked%' THEN
    RAISE EXCEPTION 'خطر: سياسة رفع الحجب لا تحصر نفسها في الصفوف المحجوبة — %', _def;
  END IF;

  RAISE NOTICE 'ok: owner reads bookings of their units, blocks and releases only blocks';
END $$;
