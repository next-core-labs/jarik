-- الحجز اليومي (شاليهات، استراحات، وحدات مفروشة) — المخطط والتسعير ومنع التزاحم.
--
-- الفرق عن الإيجار السنوي: الوحدة لا تُؤجَّر مرة واحدة بعقد، بل تُحجز ليالي متفرّقة لضيوف مختلفين.
-- فالصحّة هنا ليست في عرض البيانات بل في **ألا تُحجز ليلة واحدة مرتين** — وهذا ما يحرسه قيد
-- EXCLUDE على مستوى القاعدة، لا تحقّق في التطبيق يمكن أن تسبقه نافذة تزامن.
--
-- التسعير: سعر ليلة لأيام الأسبوع وآخر لنهاية الأسبوع (ليلة الخميس وليلة الجمعة) — كما يسعّر السوق
-- السعودي فعلًا. والسعر يُحتسب في القاعدة لا في المتصفح: ما يراه الضيف هو ما يُسجَّل عليه.
--
-- النظام السعودي: التأجير اليومي للفلل والوحدات والاستراحات يتطلب **رخصة إيواء سياحي** من وزارة
-- السياحة (سنوية). فرقمها شرط نشرٍ لأي وحدة للحجز اليومي، كما صار ترخيص «وافي» شرطًا للمشاريع.
-- تنبيه للمشغّل: تسويق وحدات الإيواء عبر منصة غير مرخّصة ممنوع نظامًا — ترخيص المنصة نفسها
-- قرار يخصّ جارك ولا يحلّه كود (مذكور في DEPLOY ومخرجات هذه الجلسة).
--
-- النطاق: المدى `[دخول، خروج)` — يوم الخروج حرّ للضيف التالي، فحجز ينتهي في الخامس وآخر يبدأ في
-- الخامس لا يتزاحمان. هذه دلالة الفنادق الصحيحة.

-- btree_gist لازم لقيد EXCLUDE على (uuid =, daterange &&).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'btree_gist') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS btree_gist';
  ELSE
    RAISE EXCEPTION 'btree_gist غير متاح — لا يمكن ضمان منع الحجز المزدوج بلا قيد EXCLUDE';
  END IF;
END $$;

-- ── 1. إعدادات الحجز لكل وحدة (جدول منفصل: units عريض أصلًا وحرّاسها تنسخ أعمدته) ──────────────
CREATE TABLE IF NOT EXISTS public.unit_booking_settings (
  unit_id uuid PRIMARY KEY REFERENCES public.units(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  /** سعر الليلة في أيام الأسبوع. شرط النشر: أكبر من صفر. */
  nightly_rate numeric CHECK (nightly_rate IS NULL OR nightly_rate > 0),
  /** سعر ليلة نهاية الأسبوع (الخميس والجمعة) — يرجع إلى سعر الأسبوع حين لا يُحدَّد. */
  weekend_rate numeric CHECK (weekend_rate IS NULL OR weekend_rate > 0),
  min_nights smallint NOT NULL DEFAULT 1 CHECK (min_nights BETWEEN 1 AND 90),
  max_guests smallint CHECK (max_guests IS NULL OR max_guests BETWEEN 1 AND 500),
  checkin_time time NOT NULL DEFAULT '16:00',
  checkout_time time NOT NULL DEFAULT '12:00',
  /** رخصة الإيواء السياحي (وزارة السياحة) — شرط نشر الوحدة للحجز اليومي. */
  tourism_license_no text CHECK (tourism_license_no IS NULL OR char_length(tourism_license_no) <= 40),
  /** إلغاء مجاني حتى هذا العدد من الأيام قبل الدخول؛ 0 = لا إلغاء مجاني. */
  free_cancel_days smallint NOT NULL DEFAULT 3 CHECK (free_cancel_days BETWEEN 0 AND 60),
  house_rules text CHECK (house_rules IS NULL OR char_length(house_rules) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── 2. الحجوزات — ومعها حجب التواريخ (حالة واحدة «blocked») فمصدر الإتاحة واحد ──────────────────
CREATE TABLE IF NOT EXISTS public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL,
  /** ضيف بلا حساب: اسم ورقم فقط (مثل unit_requests) — لا يُدرَج إلا من الخادم. */
  guest_name text CHECK (guest_name IS NULL OR char_length(btrim(guest_name)) BETWEEN 2 AND 120),
  guest_phone text CHECK (guest_phone IS NULL OR char_length(guest_phone) BETWEEN 9 AND 20),
  guest_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  guests smallint CHECK (guests IS NULL OR guests BETWEEN 1 AND 500),
  /** [دخول، خروج) — يوم الخروج حرّ للضيف التالي. */
  stay daterange NOT NULL,
  nights integer NOT NULL CHECK (nights > 0),
  /** الإجمالي كما احتسبته القاعدة لحظة الحجز، لا كما أرسله المتصفح. */
  total_amount numeric NOT NULL CHECK (total_amount >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'blocked', 'rejected', 'cancelled', 'completed')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 600),
  /** سبب الحجب أو الرفض أو الإلغاء. */
  staff_note text CHECK (staff_note IS NULL OR char_length(staff_note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CONSTRAINT bookings_stay_bounds CHECK (
    lower_inc(stay) AND NOT upper_inc(stay) AND lower(stay) < upper(stay)
  ),
  -- الحجب لا يحمل ضيفًا، والحجز يحمله.
  CONSTRAINT bookings_guest_required CHECK (
    status = 'blocked' OR (guest_name IS NOT NULL AND guest_phone IS NOT NULL)
  )
);

-- ★ جوهر الصحّة: ليلة واحدة لا تُشغَل مرتين. الحالات المُشغِلة فقط (المرفوض والملغى يُحرّران المدى).
ALTER TABLE public.bookings DROP CONSTRAINT IF EXISTS bookings_no_overlap;
ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (unit_id WITH =, stay WITH &&)
  WHERE (status IN ('pending', 'confirmed', 'blocked'));

CREATE INDEX IF NOT EXISTS bookings_unit_idx ON public.bookings (unit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_org_idx ON public.bookings (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS bookings_phone_idx ON public.bookings (guest_phone, created_at DESC);

-- ── 3. الصلاحيات ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.org_of_booking_unit(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id))
  FROM public.units u LEFT JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = _unit_id
$$;
REVOKE ALL ON FUNCTION private.org_of_booking_unit(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.org_of_booking_unit(uuid) TO authenticated, service_role;

-- can_manage_project_org هو نفس الفحص (موظف عضو في المكتب) لكن اسمه يخصّ المشاريع؛ هذا اسم محايد
-- تستخدمه الحجوزات، فلا يقرأ أحد سياسة حجز ويظن أن لها علاقة بالمشاريع.
CREATE OR REPLACE FUNCTION private.can_manage_org(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL
    AND public.is_staff(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.kind = 'member'
    )
$$;
REVOKE ALL ON FUNCTION private.can_manage_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_org(uuid) TO authenticated, service_role;

ALTER TABLE public.unit_booking_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.unit_booking_settings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_booking_settings TO authenticated;
GRANT ALL ON public.unit_booking_settings TO service_role;
DROP POLICY IF EXISTS unit_booking_settings_office ON public.unit_booking_settings;
CREATE POLICY unit_booking_settings_office ON public.unit_booking_settings FOR ALL TO authenticated
  USING (private.can_manage_org(private.org_of_booking_unit(unit_id)))
  WITH CHECK (private.can_manage_org(private.org_of_booking_unit(unit_id)));

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bookings FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.bookings TO authenticated;
GRANT ALL ON public.bookings TO service_role;
DROP POLICY IF EXISTS bookings_office ON public.bookings;
CREATE POLICY bookings_office ON public.bookings FOR ALL TO authenticated
  USING (private.can_manage_org(org_id))
  WITH CHECK (private.can_manage_org(org_id));
-- الضيف المسجَّل يرى حجوزاته هو.
DROP POLICY IF EXISTS bookings_guest_read ON public.bookings;
CREATE POLICY bookings_guest_read ON public.bookings FOR SELECT TO authenticated
  USING (guest_user_id = auth.uid());

-- مكتب الوحدة يُملأ في القاعدة لا من العميل.
CREATE OR REPLACE FUNCTION private.fill_booking_org()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.org_id := private.org_of_booking_unit(NEW.unit_id);
    NEW.nights := upper(NEW.stay) - lower(NEW.stay);
  ELSE
    NEW.unit_id := OLD.unit_id;
    NEW.org_id := OLD.org_id;
    NEW.total_amount := OLD.total_amount;
    IF NEW.status IS DISTINCT FROM OLD.status THEN NEW.decided_at := now(); END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a0_fill_booking_org ON public.bookings;
CREATE TRIGGER a0_fill_booking_org BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION private.fill_booking_org();

-- ── 4. التسعير في القاعدة: ما يراه الضيف هو ما يُسجَّل ──────────────────────────────────────────
-- ليلة نهاية الأسبوع = ليلة تبدأ يوم الخميس (4) أو الجمعة (5) — كما يسعّر السوق السعودي.
CREATE OR REPLACE FUNCTION public.quote_booking(_unit_id uuid, _from date, _to date)
RETURNS TABLE (
  available boolean, reason text, nights integer,
  weekday_nights integer, weekend_nights integer,
  nightly_rate numeric, weekend_rate numeric, total numeric,
  min_nights smallint, max_guests smallint,
  checkin_time time, checkout_time time, free_cancel_days smallint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.unit_booking_settings%ROWTYPE; _nights integer; _we integer; _wd integer;
  _taken boolean; _listed boolean; _we_rate numeric;
BEGIN
  SELECT * INTO s FROM public.unit_booking_settings WHERE unit_id = _unit_id;
  SELECT EXISTS (SELECT 1 FROM public.bookable_units_public b WHERE b.id = _unit_id) INTO _listed;

  _nights := _to - _from;
  _we_rate := COALESCE(s.weekend_rate, s.nightly_rate);

  IF s.unit_id IS NULL OR NOT s.enabled OR NOT _listed THEN
    RETURN QUERY SELECT false, 'هذه الوحدة غير متاحة للحجز اليومي'::text, 0, 0, 0,
      NULL::numeric, NULL::numeric, 0::numeric, 1::smallint, NULL::smallint,
      '16:00'::time, '12:00'::time, 0::smallint;
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE extract(dow from d) IN (4, 5))::integer,
         count(*) FILTER (WHERE extract(dow from d) NOT IN (4, 5))::integer
  INTO _we, _wd
  FROM generate_series(_from, _to - 1, interval '1 day') AS g(d);

  SELECT EXISTS (
    SELECT 1 FROM public.bookings bk
    WHERE bk.unit_id = _unit_id
      AND bk.status IN ('pending', 'confirmed', 'blocked')
      AND bk.stay && daterange(_from, _to, '[)')
  ) INTO _taken;

  RETURN QUERY SELECT
    CASE
      WHEN _nights <= 0 THEN false
      WHEN _from < CURRENT_DATE THEN false
      WHEN _nights < s.min_nights THEN false
      WHEN _taken THEN false
      WHEN COALESCE(s.nightly_rate, 0) <= 0 THEN false
      ELSE true
    END,
    CASE
      WHEN _nights <= 0 THEN 'اختر تاريخ دخول وخروج صحيحين'
      WHEN _from < CURRENT_DATE THEN 'لا يمكن الحجز في تاريخ ماضٍ'
      WHEN _nights < s.min_nights THEN 'أقل مدة حجز ' || s.min_nights || ' ليلة'
      WHEN _taken THEN 'هذه الليالي محجوزة — اختر تواريخ أخرى'
      WHEN COALESCE(s.nightly_rate, 0) <= 0 THEN 'لم يُحدَّد سعر الليلة بعد'
      ELSE NULL
    END::text,
    _nights, _wd, _we, s.nightly_rate, _we_rate,
    (COALESCE(_wd, 0) * COALESCE(s.nightly_rate, 0) + COALESCE(_we, 0) * COALESCE(_we_rate, 0)),
    s.min_nights, s.max_guests, s.checkin_time, s.checkout_time, s.free_cancel_days;
END $$;
REVOKE ALL ON FUNCTION public.quote_booking(uuid, date, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.quote_booking(uuid, date, date) TO anon, authenticated, service_role;

-- ── 5. إنشاء الحجز: السعر يُعاد احتسابه، والتزاحم يرفضه القيد لا الفحص ─────────────────────────
CREATE OR REPLACE FUNCTION public.create_booking_request(
  _unit_id uuid, _from date, _to date, _guest_name text, _guest_phone text,
  _guests integer DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q record; _id uuid;
BEGIN
  SELECT * INTO q FROM public.quote_booking(_unit_id, _from, _to);
  IF NOT q.available THEN
    RAISE EXCEPTION '%', COALESCE(q.reason, 'الحجز غير متاح') USING ERRCODE = 'P0001';
  END IF;
  IF q.max_guests IS NOT NULL AND _guests IS NOT NULL AND _guests > q.max_guests THEN
    RAISE EXCEPTION 'أقصى عدد ضيوف لهذه الوحدة %', q.max_guests USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO public.bookings
      (unit_id, guest_name, guest_phone, guests, stay, nights, total_amount, notes, status)
    VALUES (_unit_id, btrim(_guest_name), btrim(_guest_phone), _guests,
            daterange(_from, _to, '[)'), q.nights, q.total, nullif(btrim(_notes), ''), 'pending')
    RETURNING id INTO _id;
  EXCEPTION WHEN exclusion_violation THEN
    -- طلبان على نفس الليالي في اللحظة نفسها: القيد يرفض الثاني، والرسالة تُفهم للضيف.
    RAISE EXCEPTION 'سُبقت إلى هذه الليالي قبل لحظات — اختر تواريخ أخرى' USING ERRCODE = 'P0001';
  END;

  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.create_booking_request(uuid, date, date, text, text, integer, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking_request(uuid, date, date, text, text, integer, text)
  TO service_role;

-- ── 6. العروض العامة ────────────────────────────────────────────────────────────────────────────
-- سوقان منفصلان، لا واحد:
--   vacant_units_public  = الإيجار السنوي والبيع — يشترط سعرًا سنويًا أو سعر بيع > 0.
--   bookable_units_public = الحجز اليومي — يشترط سعر ليلة > 0 ورخصة إيواء.
-- ولهذا لا يُبنى هذا العرض على ذاك: شاليه للحجز اليومي ليس له سعر سنوي، فلو بُني عليه لخرج فارغًا؛
-- ولو خفّفنا شرط السعر هناك لظهرت الشاليهات في سوق الإيجار السنوي بسعر «0 ر.س». ووحدة لها السعران
-- تظهر في السوقين معًا، وهو الصحيح. بوابة المكتب والوحدة هي نفسها حرفيًا في الاثنين.
CREATE OR REPLACE VIEW public.bookable_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, p.city,
  u.rooms, u.halls, u.bathrooms, u.area, u.furnished, u.furnishing,
  u.listing_description, u.amenities,
  round(p.lat::numeric, 2) AS lat, round(p.lng::numeric, 2) AS lng,
  (u.featured OR (u.featured_until > now()) IS TRUE) AS featured,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id
    ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  u.created_at,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  s.nightly_rate, s.weekend_rate, s.min_nights, s.max_guests,
  s.checkin_time, s.checkout_time, s.free_cancel_days, s.house_rules, s.tourism_license_no
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = u.market_org_id
JOIN public.unit_booking_settings s ON s.unit_id = u.id
WHERE u.status = 'vacant' AND u.market_listed
  AND (u.market_paid_until IS NULL OR u.market_paid_until > now())
  AND u.market_org_id = COALESCE(p.org_id, private.unit_agreement_org(u.id))
  AND (p.org_id IS NOT NULL OR private.agreement_permission(u.id, u.market_org_id, 'leasing'))
  AND s.enabled
  AND COALESCE(s.nightly_rate, 0) > 0
  -- النظام السعودي: لا تُعرض وحدة للحجز اليومي بلا رخصة إيواء سياحي من وزارة السياحة.
  AND s.tourism_license_no IS NOT NULL AND btrim(s.tourism_license_no) <> '';
GRANT SELECT ON public.bookable_units_public TO anon, authenticated;

-- الليالي المشغولة لوحدة معروضة للحجز — بلا أي بيانات ضيف. يحتاجها تقويم الزائر.
CREATE OR REPLACE VIEW public.unit_booked_dates_public AS
SELECT bk.unit_id, lower(bk.stay) AS from_date, upper(bk.stay) AS to_date
FROM public.bookings bk
WHERE bk.status IN ('pending', 'confirmed', 'blocked')
  AND upper(bk.stay) >= CURRENT_DATE
  AND EXISTS (SELECT 1 FROM public.bookable_units_public b WHERE b.id = bk.unit_id);
GRANT SELECT ON public.unit_booked_dates_public TO anon, authenticated;

-- ── 7. التحقق: تنفيذ فعلي للتسعير ومنع التزاحم، بلا أثر ─────────────────────────────────────────
DO $$
DECLARE _unit uuid; q record; _b1 uuid; _from date := CURRENT_DATE + 10; _to date := CURRENT_DATE + 13;
BEGIN
  PERFORM 1 FROM public.bookable_units_public LIMIT 1;
  PERFORM 1 FROM public.unit_booked_dates_public LIMIT 1;
  RAISE NOTICE 'booking views OK';

  -- وحدة منشورة فعلًا: bookable_units_public يشترط بوابة العروض كاملة (مكتب موثّق ظاهر، وحدة
  -- شاغرة منشورة)، فوحدة عشوائية لن تظهر فيه ولو فُعّلت إعداداتها.
  SELECT id INTO _unit FROM public.vacant_units_public LIMIT 1;
  IF _unit IS NULL THEN
    RAISE NOTICE 'no published unit to probe with — pricing probe skipped';
    RETURN;
  END IF;

  BEGIN
    -- وحدة بلا إعدادات حجز: غير متاحة، برسالة مفهومة.
    SELECT * INTO q FROM public.quote_booking(_unit, _from, _to);
    IF q.available THEN RAISE EXCEPTION 'probe_failed: وحدة بلا إعدادات ظهرت متاحة'; END IF;

    -- فعّل الحجز بسعرين، ثم تحقّق من احتساب ليالي نهاية الأسبوع.
    INSERT INTO public.unit_booking_settings
      (unit_id, enabled, nightly_rate, weekend_rate, min_nights, tourism_license_no)
    VALUES (_unit, true, 1000, 2000, 1, 'TL-PROBE')
    ON CONFLICT (unit_id) DO UPDATE
      SET enabled = true, nightly_rate = 1000, weekend_rate = 2000,
          min_nights = 1, tourism_license_no = 'TL-PROBE';

    SELECT * INTO q FROM public.quote_booking(_unit, _from, _to);
    IF q.nights <> 3 THEN RAISE EXCEPTION 'probe_failed: عدد الليالي % بدل 3', q.nights; END IF;
    IF q.weekday_nights + q.weekend_nights <> 3 THEN
      RAISE EXCEPTION 'probe_failed: تقسيم الليالي لا يجمع إلى 3';
    END IF;
    IF q.total <> q.weekday_nights * 1000 + q.weekend_nights * 2000 THEN
      RAISE EXCEPTION 'probe_failed: الإجمالي % لا يطابق التقسيم', q.total;
    END IF;

    -- الحجز في الماضي مرفوض.
    SELECT * INTO q FROM public.quote_booking(_unit, CURRENT_DATE - 2, CURRENT_DATE + 1);
    IF q.available THEN RAISE EXCEPTION 'probe_failed: تاريخ ماضٍ قُبل'; END IF;

    -- حجز ناجح، ثم ★ تزاحم يجب أن يُرفض.
    _b1 := public.create_booking_request(_unit, _from, _to, 'ضيف فحص', '0500000000', 2, NULL);
    IF _b1 IS NULL THEN RAISE EXCEPTION 'probe_failed: لم يُنشأ الحجز'; END IF;

    BEGIN
      PERFORM public.create_booking_request(
        _unit, _from + 1, _to + 1, 'ضيف ثانٍ', '0500000001', 2, NULL);
      RAISE EXCEPTION 'probe_failed: حجز متزاحم قُبل';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'probe_failed%' THEN RAISE; END IF;
    END;

    -- يوم الخروج حرّ للضيف التالي: حجز يبدأ يوم خروج الأول يجب أن يُقبل.
    PERFORM public.create_booking_request(_unit, _to, _to + 2, 'ضيف ثالث', '0500000002', 2, NULL);

    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'probe_rollback' THEN
      RAISE NOTICE 'booking pricing + no-overlap + checkout-day handover all OK (no rows kept)';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
