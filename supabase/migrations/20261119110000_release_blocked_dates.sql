-- «إلغاء الحجب» كان يفشل دائمًا بـ400 (قيد 23514)، فالمكتب يحجب تواريخ ولا يستطيع تحريرها أبدًا.
--
-- السبب: الحجب يُدخَل بلا اسم ضيف ولا جوال — وهذا صحيح، فحجب التواريخ ليس حجزًا لأحد — والقيد
-- bookings_guest_required (20261118230000) يسمح بذلك بشرط أن تكون الحالة 'blocked' وحدها:
--     status = 'blocked' OR (guest_name IS NOT NULL AND guest_phone IS NOT NULL)
-- وزر «إلغاء الحجب» يضع الحالة 'cancelled'، فيصبح الشرط: ليست blocked ولا يوجد ضيف → رفض.
-- كل ضغطة على الزر كانت تفشل، بلا استثناء.
--
-- الإصلاح: القيد يعترف بأن الحجب الملغى لا ضيف له. ولا يُضعف الحماية: الحجز يُدخَل بحالة
-- 'pending' افتراضيًا فيبقى ملزَمًا باسم الضيف وجواله، والحجز الحقيقي الملغى يحتفظ ببيانات ضيفه
-- كما هي — القيد يسمح بالفراغ ولا يفرضه.
--
-- القيد الجديد أوسع من القديم، فلا صفّ قائم يخالفه. وقيد عدم التزاحم (bookings_no_overlap) لا
-- يتأثر: 'cancelled' خارج مجموعته أصلًا، فالتواريخ تُحرَّر للضيف التالي كما هو مقصود.

ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_guest_required;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_guest_required CHECK (
  status IN ('blocked', 'cancelled') OR (guest_name IS NOT NULL AND guest_phone IS NOT NULL)
);

-- تحقّق بلا أي كتابة: القيد الجديد يسمح بالحجب الملغى ويبقى مُلزِمًا بالضيف لما سواه.
-- (الفحص بإدخال صفوف تجريبية مرفوض عمدًا: هذا جدول حجوزات حقيقي في الإنتاج.)
DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _def
  FROM pg_constraint
  WHERE conrelid = 'public.bookings'::regclass AND conname = 'bookings_guest_required';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'القيد bookings_guest_required غير موجود بعد الاستبدال';
  END IF;
  IF _def NOT LIKE '%cancelled%' THEN
    RAISE EXCEPTION 'الإصلاح لم يُطبَّق: القيد ما زال يرفض الحجب الملغى — %', _def;
  END IF;
  IF _def NOT LIKE '%guest_name IS NOT NULL%' OR _def NOT LIKE '%guest_phone IS NOT NULL%' THEN
    RAISE EXCEPTION 'تراجع: القيد لم يبقَ مُلزِمًا باسم الضيف وجواله — %', _def;
  END IF;
  RAISE NOTICE 'ok: released blocks accepted, guest still required otherwise';
END $$;
