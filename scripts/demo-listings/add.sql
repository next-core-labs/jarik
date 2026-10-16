-- Sample listings so the public market isn't empty before real offices publish.
--
--   supabase db query --linked -f scripts/demo-listings/add.sql      # add (safe to re-run: no-op)
--   supabase db query --linked -f scripts/demo-listings/remove.sql   # remove everything again
--
-- Everything hangs off one office, «حساب تجريبي — جارك» (fixed id below). It deliberately has no FAL
-- licence and no phone, so listing pages show no call/WhatsApp buttons, and every listing is titled
-- «إعلان تجريبي» with a description that says it is a sample. Districts and map positions are real
-- (OpenStreetMap), prices are typical for Riyadh in 2026. No photos: nothing pretends to be a real
-- property. One statement (data-modifying CTEs) so it applies all-or-nothing.
WITH office AS (
  INSERT INTO public.org_settings (id, company_name, verified, listed_publicly, city, district, bio)
  VALUES ('de300000-0000-4000-8000-000000000001', 'حساب تجريبي — جارك', true, true, 'الرياض', NULL,
          'حساب تجريبي يعرض كيف تظهر العروض في جارك. الإعلانات هنا أمثلة وليست عقارات متاحة، ولا يمكن التواصل بشأنها.')
  ON CONFLICT (id) DO NOTHING
  RETURNING id
),
demo (n, district, lat, lng, unit_type, purpose, price, rooms, halls, baths, area, floor_no, furnished, amenities) AS (
  VALUES
  (1,  'الملقا',   24.8010, 46.6007, 'شقة',        'rent',   65000, 3,    1, 2, 150, '2',    false, ARRAY['مصعد','موقف سيارات','مكيفات راكبة','مطبخ راكب']),
  (2,  'النرجس',   24.8341, 46.6802, 'دور',        'rent',   85000, 4,    2, 3, 240, '1',    false, ARRAY['مدخل خاص','سطح خاص','موقف سيارات']),
  (3,  'الياسمين', 24.8169, 46.6361, 'شقة',        'rent',   45000, 2,    1, 2, 110, '3',    false, ARRAY['مصعد','موقف سيارات','قريب من الخدمات']),
  (4,  'حطين',     24.7611, 46.6021, 'فيلا',       'sale', 3900000, 6,    3, 6, 400, NULL,   false, ARRAY['غرفة خادمة','غرفة سائق','مسبح','موقف سيارات']),
  (5,  'الصحافة',  24.7969, 46.6401, 'استوديو',    'rent',   28000, 1,    0, 1,  45, '1',    true,  ARRAY['مكيفات راكبة','مطبخ راكب','إنترنت / ألياف']),
  (6,  'قرطبة',    24.8132, 46.7329, 'شقة',        'rent',   48000, 3,    1, 2, 130, '2',    false, ARRAY['مصعد','مطبخ راكب']),
  (7,  'الربوة',   24.6934, 46.7589, 'شقة',        'rent',   40000, 4,    1, 2, 160, 'أرضي', false, ARRAY['مدخل خاص','قريب من الخدمات']),
  (8,  'العليا',   24.6931, 46.6845, 'مكتب',       'rent',   95000, NULL, 0, 2, 120, '5',    false, ARRAY['مصعد','تكييف مركزي','موقف سيارات','حراسة وأمن']),
  (9,  'العارض',   24.8935, 46.6060, 'فيلا',       'sale', 2350000, 5,    2, 5, 312, NULL,   false, ARRAY['غرفة خادمة','سطح خاص']),
  (10, 'النخيل',   24.7422, 46.6375, 'محل تجاري',  'rent',   70000, NULL, 0, 1,  80, 'أرضي', false, ARRAY['موقف سيارات']),
  (11, 'الروضة',   24.7341, 46.7672, 'دور',        'rent',   55000, 3,    1, 2, 200, '1',    false, ARRAY['مدخل خاص','مكيفات راكبة']),
  (12, 'الملقا',   24.8048, 46.6071, 'أرض سكنية',  'sale', 2700000, NULL, 0, 0, 600, NULL,   false, ARRAY[]::text[])
),
props AS (
  INSERT INTO public.properties (org_id, name, property_type, city, district, lat, lng, notes)
  SELECT o.id, 'عقار تجريبي ' || d.n, CASE WHEN d.unit_type IN ('مكتب', 'محل تجاري') THEN 'تجاري'
                                           WHEN d.unit_type = 'أرض سكنية' THEN 'أراضٍ ومزارع' ELSE 'سكني' END,
         'الرياض', d.district, d.lat, d.lng, 'demo-listing ' || d.n
  FROM office o CROSS JOIN demo d
  RETURNING id, notes
)
INSERT INTO public.units (property_id, unit_number, unit_name, unit_type, district, floor_no, rooms, halls,
  bathrooms, area, furnished, listing_purpose, annual_rent, sale_price, listing_description, amenities,
  status, market_listed, market_listed_at)
SELECT p.id, 'D' || d.n, 'إعلان تجريبي', d.unit_type, d.district, d.floor_no, d.rooms, d.halls, d.baths,
  d.area, d.furnished, d.purpose,
  CASE WHEN d.purpose = 'rent' THEN d.price ELSE 0 END,
  CASE WHEN d.purpose = 'sale' THEN d.price ELSE 0 END,
  'هذا إعلان تجريبي يوضح طريقة عرض الوحدات في جارك، وليس عقارًا متاحًا. ستظهر هنا عروض المكاتب العقارية المرخّصة فور نشرها.',
  d.amenities, 'vacant', true, now() - make_interval(hours => d.n)
FROM props p JOIN demo d ON p.notes = 'demo-listing ' || d.n;
