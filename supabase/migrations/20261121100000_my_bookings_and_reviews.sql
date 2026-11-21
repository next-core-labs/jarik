-- «حجوزاتي» والتقييم بالاتجاهين.
--
-- المشكلة: الضيف يحجز وهو داخل بحسابه، ينتهي الحجز، ولا يجد له أثرًا في حسابه. السبب أن
-- create_booking_request لا تملأ guest_user_id أبدًا — فسياسة bookings_guest_read (الضيف يرى
-- حجوزاته) لم تُطابق صفًّا واحدًا منذ وُجدت. الخادم صار يربط الحجز بالحساب عند الإنشاء
-- (bookings.functions.ts)، وهذا الملف يربط ما سبق ويضيف ما يلزم للعرض والتقييم.
--
-- التقييم: بعد انتهاء الحجز ('completed') فقط، ومرة واحدة لكل اتجاه:
--   guest_to_unit  الضيف يقيّم الوحدة — يظهر علنًا على صفحة الوحدة.
--   host_to_guest  المكتب (صاحب الوحدة) يقيّم الضيف — يراه الضيف والمكتب فقط، لا يُنشر.
-- لا إدراج مباشرًا في الجدول: كل تقييم يمرّ من submit_booking_review التي تتحقق من صاحب الحق
-- ومن حالة الحجز. والتقييم لا يُعدَّل بعد إرساله.

-- ── 1. ربط الحجوزات السابقة بحسابات أصحابها ──────────────────────────────────────────────────
-- مرة واحدة، بمطابقة جوال الحجز مع جوال الحساب (آخر 9 أرقام، فالصيغتان 05… و +9665… تتطابقان)،
-- وفقط حين يحمل الرقمَ حسابٌ واحد بالضبط — رقم مشترك بين حسابين لا يُحسم لأحدهما.
UPDATE public.bookings b
SET guest_user_id = p.id
FROM public.profiles p
WHERE b.guest_user_id IS NULL
  AND b.guest_phone IS NOT NULL
  AND b.status <> 'blocked'
  AND length(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g')) >= 9
  AND right(regexp_replace(p.phone, '\D', '', 'g'), 9)
      = right(regexp_replace(b.guest_phone, '\D', '', 'g'), 9)
  AND (
    SELECT count(*) FROM public.profiles p2
    WHERE length(regexp_replace(COALESCE(p2.phone, ''), '\D', '', 'g')) >= 9
      AND right(regexp_replace(p2.phone, '\D', '', 'g'), 9)
          = right(regexp_replace(b.guest_phone, '\D', '', 'g'), 9)
  ) = 1;

CREATE INDEX IF NOT EXISTS bookings_guest_user_idx
  ON public.bookings (guest_user_id, created_at DESC) WHERE guest_user_id IS NOT NULL;

-- ── 2. جدول التقييمات ────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.booking_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL,
  direction text NOT NULL CHECK (direction IN ('guest_to_unit', 'host_to_guest')),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 600),
  author_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- تقييم واحد لكل اتجاه في الحجز الواحد.
  CONSTRAINT booking_reviews_once UNIQUE (booking_id, direction)
);
CREATE INDEX IF NOT EXISTS booking_reviews_unit_idx
  ON public.booking_reviews (unit_id, created_at DESC) WHERE direction = 'guest_to_unit';

ALTER TABLE public.booking_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_reviews FROM PUBLIC, anon, authenticated;
-- قراءة فقط: الكتابة من submit_booking_review وحدها.
GRANT SELECT ON public.booking_reviews TO authenticated;
GRANT ALL ON public.booking_reviews TO service_role;

DROP POLICY IF EXISTS booking_reviews_office_read ON public.booking_reviews;
CREATE POLICY booking_reviews_office_read ON public.booking_reviews FOR SELECT TO authenticated
  USING (private.can_manage_org(org_id));
DROP POLICY IF EXISTS booking_reviews_guest_read ON public.booking_reviews;
CREATE POLICY booking_reviews_guest_read ON public.booking_reviews FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = booking_reviews.booking_id AND b.guest_user_id = auth.uid()
  ));

-- ── 3. إرسال التقييم ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_booking_review(
  _booking_id uuid, _direction text, _rating integer, _comment text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE b public.bookings%ROWTYPE; _id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'سجّل الدخول أولًا' USING ERRCODE = '42501';
  END IF;
  IF _direction NOT IN ('guest_to_unit', 'host_to_guest') THEN
    RAISE EXCEPTION 'اتجاه تقييم غير معروف' USING ERRCODE = 'P0001';
  END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN
    RAISE EXCEPTION 'اختر تقييمًا من نجمة إلى خمس' USING ERRCODE = 'P0001';
  END IF;
  IF char_length(COALESCE(_comment, '')) > 600 THEN
    RAISE EXCEPTION 'التعليق أطول من 600 حرف' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  -- حجز غير موجود وحجز ليس لك: الرسالة نفسها، فلا يُكشف وجود حجز لغير صاحبه.
  IF b.id IS NULL
     OR (_direction = 'guest_to_unit' AND b.guest_user_id IS DISTINCT FROM auth.uid())
     OR (_direction = 'host_to_guest' AND NOT private.can_manage_org(b.org_id)) THEN
    RAISE EXCEPTION 'هذا الحجز غير متاح لك للتقييم' USING ERRCODE = '42501';
  END IF;
  IF b.status <> 'completed' THEN
    RAISE EXCEPTION 'التقييم يُفتح بعد انتهاء الحجز' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.booking_reviews
      (booking_id, unit_id, org_id, direction, rating, comment, author_user_id)
    VALUES (b.id, b.unit_id, b.org_id, _direction, _rating,
            nullif(btrim(COALESCE(_comment, '')), ''), auth.uid())
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'سبق أن قيّمت هذا الحجز' USING ERRCODE = 'P0001';
  END;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.submit_booking_review(uuid, text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_booking_review(uuid, text, integer, text)
  TO authenticated, service_role;

-- ── 4. حجوزات الضيف ──────────────────────────────────────────────────────────────────────────
-- دالة لا قراءة مباشرة: الضيف لا يملك صلاحية على units ولا org_settings، و bookable_units_public
-- يُسقط الوحدة حين تُسحب من العرض — وحجز منتهٍ على وحدة سُحبت يجب أن يبقى ظاهرًا باسمها.
-- staff_note لا يُرجَع: ملاحظة المكتب له وحده.
CREATE OR REPLACE FUNCTION public.my_bookings()
RETURNS TABLE (
  id uuid, unit_id uuid, status text, from_date date, to_date date, nights integer,
  total_amount numeric, guests smallint, created_at timestamptz,
  unit_name text, unit_number text, unit_type text, district text, city text, cover_path text,
  office_name text, office_phone text, office_whatsapp text, listed boolean,
  my_rating smallint, my_comment text, host_rating smallint, host_comment text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.id, b.unit_id, b.status, lower(b.stay), upper(b.stay), b.nights,
    b.total_amount, b.guests, b.created_at,
    u.unit_name::text, u.unit_number::text, u.unit_type::text, u.district::text, p.city::text,
    (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id
      ORDER BY ph.position LIMIT 1)::text,
    o.company_name::text, o.office_phone::text, o.whatsapp_number::text,
    EXISTS (SELECT 1 FROM public.bookable_units_public bu WHERE bu.id = b.unit_id),
    mine.rating, mine.comment, host.rating, host.comment
  FROM public.bookings b
  JOIN public.units u ON u.id = b.unit_id
  LEFT JOIN public.properties p ON p.id = u.property_id
  LEFT JOIN public.org_settings o ON o.id = b.org_id
  LEFT JOIN public.booking_reviews mine
    ON mine.booking_id = b.id AND mine.direction = 'guest_to_unit'
  LEFT JOIN public.booking_reviews host
    ON host.booking_id = b.id AND host.direction = 'host_to_guest'
  WHERE b.guest_user_id = auth.uid() AND b.status <> 'blocked'
  ORDER BY b.created_at DESC
  LIMIT 200
$$;
REVOKE ALL ON FUNCTION public.my_bookings() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_bookings() TO authenticated, service_role;

-- ── 5. التقييمات العلنية للوحدة ──────────────────────────────────────────────────────────────
-- تقييم الضيف للوحدة فقط، وبالاسم الأول وحده. وكبقية عروض الحجز: للوحدات المعروضة فعلًا.
CREATE OR REPLACE VIEW public.unit_reviews_public AS
SELECT r.id, r.unit_id, r.rating, r.comment, r.created_at,
  split_part(btrim(bk.guest_name), ' ', 1) AS guest_first_name
FROM public.booking_reviews r
JOIN public.bookings bk ON bk.id = r.booking_id
WHERE r.direction = 'guest_to_unit'
  AND EXISTS (SELECT 1 FROM public.bookable_units_public b WHERE b.id = r.unit_id);
GRANT SELECT ON public.unit_reviews_public TO anon, authenticated;

CREATE OR REPLACE VIEW public.unit_ratings_public AS
SELECT r.unit_id, round(avg(r.rating)::numeric, 1) AS rating_avg, count(*)::integer AS reviews_count
FROM public.unit_reviews_public r
GROUP BY r.unit_id;
GRANT SELECT ON public.unit_ratings_public TO anon, authenticated;

-- ── 6. إشعار الضيف بتغيّر حالة حجزه ──────────────────────────────────────────────────────────
-- المكتب يؤكّد أو يعتذر أو ينهي الحجز من شاشته؛ بلا إشعار لا يعرف الضيف إلا إن فتح «حجوزاتي».
-- وإشعار الانتهاء هو الدعوة إلى التقييم.
CREATE OR REPLACE FUNCTION private.notify_booking_guest()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _title text; _body text; _unit text;
BEGIN
  IF NEW.guest_user_id IS NULL OR NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  _title := CASE NEW.status
    WHEN 'confirmed' THEN 'تأكّد حجزك'
    WHEN 'rejected' THEN 'اعتذر المكتب عن حجزك'
    WHEN 'cancelled' THEN 'أُلغي حجزك'
    WHEN 'completed' THEN 'كيف كانت إقامتك؟'
    ELSE NULL
  END;
  IF _title IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(NULLIF(btrim(u.unit_name), ''), 'وحدة ' || u.unit_number) INTO _unit
  FROM public.units u WHERE u.id = NEW.unit_id;
  _body := COALESCE(_unit, 'حجزك') || ' · من ' || lower(NEW.stay) || ' إلى ' || upper(NEW.stay)
    || CASE WHEN NEW.status = 'completed' THEN ' — قيّم الوحدة من «حجوزاتي».' ELSE '' END;

  BEGIN
    INSERT INTO public.notifications
      (user_id, org_id, title, body, kind, source, related_table, related_id, link)
    VALUES (NEW.guest_user_id, NEW.org_id, _title, _body, 'deal', 'system',
            'bookings', NEW.id, '/my-bookings');
  EXCEPTION WHEN OTHERS THEN
    -- فشل الإشعار لا يُفشل تحديث الحجز نفسه.
    RAISE WARNING 'notify_booking_guest: %', SQLERRM;
  END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.notify_booking_guest() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS z_notify_booking_guest ON public.bookings;
CREATE TRIGGER z_notify_booking_guest AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.notify_booking_guest();

-- ── 7. تحقّق بلا أي كتابة ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM 1 FROM public.unit_reviews_public LIMIT 1;
  PERFORM 1 FROM public.unit_ratings_public LIMIT 1;
  PERFORM 1 FROM public.my_bookings() LIMIT 1;

  -- بلا جلسة (الترحيل يعمل بلا auth.uid()): الدالة يجب أن ترفض، لا أن تُدرج.
  BEGIN
    PERFORM public.submit_booking_review(gen_random_uuid(), 'guest_to_unit', 5, NULL);
    RAISE EXCEPTION 'probe_failed: تقييم بلا جلسة قُبل';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF has_table_privilege('authenticated', 'public.booking_reviews', 'INSERT') THEN
    RAISE EXCEPTION 'probe_failed: الإدراج المباشر في التقييمات متاح';
  END IF;
  RAISE NOTICE 'ok: reviews gated behind submit_booking_review, public views readable';
END $$;
