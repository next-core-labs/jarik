-- يُكمل قرار 2026-11-07 (20261107160000): ذلك الترحيل أخفى إعلانات المكتب التجريبي من السوق،
-- لكن المكتب نفسه بقي عامًا — يظهر في دليل /offices، وله صفحة /office/<id> تُخرج JSON-LD من نوع
-- RealEstateAgent، ورابطه يدخل sitemap.xml أي أنه مُرشَّح لفهرسة محركات البحث كمكتب عقاري حقيقي.
--
-- السبب أن الدليل يمرّ من شرط آخر: office_directory = listed_publicly AND verified، ولا علاقة له
-- بحالة الإعلانات. فإخفاء الإعلانات وحده لم يُخفِ المكتب.
--
-- listed_publicly = false وحدها: لا نلمس verified (حقل اعتماد إداري لفريق المنصة، وليس قرار ظهور)،
-- ولا نحذف الصف — فـ scripts/demo-listings/remove.sql يبقى هو طريق الحذف، وإعادة الإظهار ضغطة.
UPDATE public.org_settings
SET listed_publicly = false
WHERE id = 'de300000-0000-4000-8000-000000000001'
  AND listed_publicly;

-- تحقّق: المكتب التجريبي لم يبقَ في العرض العام الذي يقرأه الدليل وخريطة الموقع.
DO $$
DECLARE _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.office_directory
  WHERE id = 'de300000-0000-4000-8000-000000000001';
  IF _n > 0 THEN
    RAISE EXCEPTION 'المكتب التجريبي ما زال في دليل المكاتب العام';
  END IF;
  RAISE NOTICE 'ok: demo office is out of the public directory';
END $$;
