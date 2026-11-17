-- تاريخ أسعار الأحياء — لرسم «تغيّر السعر زمنيًا» في صفحات /prices العامة:
--   لقطة يومية (pg_cron) من district_price_stats (المشتق من vacant_units_public) في جدول
--   district_price_history. الجدول مشتق من عرض عام أصلًا فلا يكشف إلا ما هو منشور علنًا
--   (قاعدة AGENTS.md)، وقراءته عامة مثل العرض نفسه. يُحتفظ بـ400 يوم.

CREATE TABLE IF NOT EXISTS public.district_price_history (
  snapshot_date date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Riyadh')::date,
  city text NOT NULL,
  district text NOT NULL,
  listing_purpose text NOT NULL,
  unit_type text NOT NULL,
  listings integer NOT NULL,
  avg_price bigint NOT NULL,
  min_price bigint NOT NULL,
  max_price bigint NOT NULL,
  avg_area integer,
  PRIMARY KEY (snapshot_date, city, district, listing_purpose, unit_type)
);
COMMENT ON TABLE public.district_price_history IS
  'لقطة يومية من district_price_stats — مادة رسم تغيّر الأسعار في صفحات /prices';

ALTER TABLE public.district_price_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.district_price_history FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.district_price_history TO anon, authenticated;
GRANT ALL ON public.district_price_history TO service_role;
DROP POLICY IF EXISTS district_price_history_public_read ON public.district_price_history;
CREATE POLICY district_price_history_public_read ON public.district_price_history
  FOR SELECT TO anon, authenticated USING (true);

-- إعادة التشغيل في نفس اليوم تحدّث لقطة اليوم بدل أن تفشل.
CREATE OR REPLACE FUNCTION public.snapshot_district_prices()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  INSERT INTO public.district_price_history
    (snapshot_date, city, district, listing_purpose, unit_type,
     listings, avg_price, min_price, max_price, avg_area)
  SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date, s.city, s.district, s.listing_purpose,
    s.unit_type, s.listings, s.avg_price, s.min_price, s.max_price, s.avg_area
  FROM public.district_price_stats s
  WHERE s.city IS NOT NULL AND s.district IS NOT NULL
    AND s.listing_purpose IS NOT NULL AND s.unit_type IS NOT NULL
    AND s.listings IS NOT NULL AND s.avg_price IS NOT NULL
    AND s.min_price IS NOT NULL AND s.max_price IS NOT NULL
  ON CONFLICT (snapshot_date, city, district, listing_purpose, unit_type)
  DO UPDATE SET listings = EXCLUDED.listings, avg_price = EXCLUDED.avg_price,
    min_price = EXCLUDED.min_price, max_price = EXCLUDED.max_price, avg_area = EXCLUDED.avg_area;
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.district_price_history
  WHERE snapshot_date < (now() AT TIME ZONE 'Asia/Riyadh')::date - 400;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.snapshot_district_prices() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_district_prices() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'district-price-snapshot') THEN
    PERFORM cron.schedule('district-price-snapshot', '45 2 * * *',
      'SELECT public.snapshot_district_prices()');
  END IF;
END $$;

-- درس 20261118120000: ما تنشئه الـCLI يعود لدور تسجيل الدخول المؤقت — المالك postgres.
ALTER TABLE public.district_price_history OWNER TO postgres;
ALTER FUNCTION public.snapshot_district_prices() OWNER TO postgres;

-- أول نقطة على الرسم من الآن، لا من الغد.
SELECT public.snapshot_district_prices();
