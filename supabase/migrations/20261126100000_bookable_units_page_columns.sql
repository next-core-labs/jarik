-- شاليه الحجز اليومي لم تكن له صفحة: كل بطاقة في /stays تفتح «العرض غير متاح حاليًا».
--
-- السبب: صفحة /unit/:id تُبنى من vacant_units_public وحدها، وهذا العرض يشترط منذ 20261118160000
-- سعرًا مطلوبًا فعليًا (إيجار سنوي أو سعر بيع > 0). والوحدة التي تُحجز بالليلة لا سعر سنوي لها
-- ولا سعر بيع — بالتعريف — فهي خارجه، فيعيد الاستعلام صفرًا فتُعرض صفحة «غير متاح». السوق يعرضها
-- (bookable_units_public)، والقاعدة تسعّرها وتقبل حجزها (quote_booking)، والصفحة الوحيدة التي
-- يصل منها الضيف إلى نموذج الحجز لا تفتح. والحجب لا علاقة له بالأمر: لا هذا العرض ولا ذاك ينظر
-- إلى جدول الحجوزات أصلًا.
--
-- الإصلاح هنا: bookable_units_public يحمل نفس أعمدة العرض التي تحتاجها الصفحة العامة، فتُبنى منه
-- كما تُبنى من vacant_units_public بلا أي فرع ثانٍ في الواجهة. الأعمدة تُضاف في آخر القائمة ولا
-- يتغيّر ترتيب ما قبلها، فـ CREATE OR REPLACE يقبلها ولا ينكسر unit_booked_dates_public المعتمد
-- عليه.
--
-- ما يبقى على حاله: بوابة النشر (مكتب موثّق ظاهر، وحدة شاغرة منشورة، اشتراك سارٍ)، واشتراط سعر
-- الليلة ورخصة الإيواء السياحي. هذا العرض لا يكشف شيئًا جديدًا: كل عمود مضاف هو نفسه عمودٌ
-- يكشفه vacant_units_public للزائر نفسه عن الوحدات الأخرى.

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
  s.checkin_time, s.checkout_time, s.free_cancel_days, s.house_rules, s.tourism_license_no,
  -- ↓ أعمدة الصفحة العامة، بنفس أسماء vacant_units_public ودلالتها حرفيًا.
  u.floor_no,
  u.annual_rent, u.sale_price, u.listing_purpose,
  CASE
    WHEN u.list_price > CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END
    THEN u.list_price
  END AS list_price,
  u.furniture,
  u.ad_license_no,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = u.market_org_id
JOIN public.unit_booking_settings s ON s.unit_id = u.id
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published AND op.org_id = o.id
WHERE u.status = 'vacant' AND u.market_listed
  AND (u.market_paid_until IS NULL OR u.market_paid_until > now())
  AND u.market_org_id = COALESCE(p.org_id, private.unit_agreement_org(u.id))
  AND (p.org_id IS NOT NULL OR private.agreement_permission(u.id, u.market_org_id, 'leasing'))
  AND s.enabled
  AND COALESCE(s.nightly_rate, 0) > 0
  -- النظام السعودي: لا تُعرض وحدة للحجز اليومي بلا رخصة إيواء سياحي من وزارة السياحة.
  AND s.tourism_license_no IS NOT NULL AND btrim(s.tourism_license_no) <> '';
GRANT SELECT ON public.bookable_units_public TO anon, authenticated;

-- تحقّق بلا أي كتابة: الأعمدة التي تحتاجها الصفحة موجودة فعلًا، والعرض ما زال يُقرأ للزائر،
-- والوحدات المعروضة للحجز اليومي اليوم صار لكل واحدة منها ما تُبنى به صفحتها.
DO $$
DECLARE _missing text; _rows bigint; _daily bigint;
BEGIN
  SELECT string_agg(c, '، ') INTO _missing
  FROM unnest(ARRAY['floor_no', 'annual_rent', 'sale_price', 'listing_purpose', 'list_price',
                    'furniture', 'ad_license_no', 'office_city', 'office_district',
                    'owner_page_id', 'owner_name', 'owner_avatar_path',
                    'contact_phone', 'contact_whatsapp']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'bookable_units_public' AND column_name = c
  );
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'أعمدة الصفحة ناقصة في bookable_units_public: %', _missing;
  END IF;

  SELECT count(*) INTO _rows FROM public.bookable_units_public;
  -- وحدات الحجز اليومي فقط: هي بالضبط من كانت صفحتها «غير متاح».
  SELECT count(*) INTO _daily
  FROM public.bookable_units_public b
  WHERE COALESCE(b.annual_rent, 0) <= 0 AND COALESCE(b.sale_price, 0) <= 0;
  RAISE NOTICE 'ok: % وحدة معروضة للحجز اليومي، منها % بلا سعر سنوي أو بيع (كانت بلا صفحة)',
    _rows, _daily;

  PERFORM 1 FROM public.unit_booked_dates_public LIMIT 1;
END $$;
