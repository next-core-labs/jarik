-- إصلاح عاجل 2026-11-18: قراءة الزوار لـ vacant_units_public (وسوق العروض كله معها) صارت تفشل بـ
-- «permission denied for function agreement_permission». السبب: إعادة إنشاء الـVIEWs في دفعات اليوم
-- جرت بدور تسجيل الدخول المؤقت في Supabase CLI الحديثة («Initialising login role…»)، ففحوص صلاحيات
-- الـVIEW لم تعد تمر بمالكٍ يملك تنفيذ دوال private (المسحوبة من PUBLIC/anon في تقوية 2026-09-24).
-- الإصلاح: كل VIEWs المخطط public مملوكة لـ postgres، مع منح postgres تنفيذ الدوال الخاصة التي
-- تستدعيها الـVIEWs العامة صراحةً حتى لا تنكسر مع أي REVOKE قادم.

DO $$
DECLARE v record;
BEGIN
  FOR v IN SELECT viewname FROM pg_views WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER VIEW public.%I OWNER TO postgres', v.viewname);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION private.agreement_permission(uuid, uuid, text) TO postgres;
GRANT EXECUTE ON FUNCTION private.unit_agreement_org(uuid) TO postgres;

-- صلاحيات القراءة العامة كما كانت (لا تتأثر بتغيير المالك، إعادة تأكيد فقط).
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
GRANT SELECT ON public.district_price_stats TO anon, authenticated;
