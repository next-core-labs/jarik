-- شارة "جودة الأداء" التلقائية على صفحة المكتب العامة: متوسط تقييم المستأجرين لطلبات الصيانة
-- المنجزة + عددها. مقياس منفصل تمامًا عن `org_settings.verified` (توثيق الهوية يبقى قرارًا يدويًا
-- للإدارة كما هو، لا نغيّره هنا) — البيانات مبنية على `office_pages_public` نفسها، التي أصلًا
-- تعرض المكاتب الموثّقة والمعروضة publicly فقط (WHERE listed_publicly AND verified)، فإضافة
-- عمودين بنهايتها كافية لضمان ظهور الشارة على المكاتب الموثّقة حصرًا بدون شرط إضافي.
CREATE OR REPLACE VIEW public.office_pages_public AS
SELECT o.id, o.company_name, o.bio, o.logo_url, o.banner_path, o.city, o.district, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count,
  (SELECT round(avg(m.rating)::numeric, 1) FROM public.maintenance_requests m
    WHERE m.org_id = o.id AND m.rating IS NOT NULL) AS avg_rating,
  (SELECT count(*) FROM public.maintenance_requests m
    WHERE m.org_id = o.id AND m.rating IS NOT NULL) AS ratings_count
FROM public.org_settings o WHERE o.listed_publicly AND o.verified;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;
