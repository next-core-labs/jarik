-- عدد زوّار الموقع لطلب "كم شخص زار الموقع" بلوحة المدير العام — لا يوجد أي تتبع عام للزيارات
-- اليوم (listing_events الموجودة مقصورة على صفحة وحدة واحدة ومكتب واحد). سجل خام بسيط: صف واحد
-- لكل تحميل صفحة عامة، مع معرّف زائر مجهول (localStorage، بلا أي بيانات شخصية) لحساب "أشخاص
-- فريدين" لا مجرد عدد مشاهدات صفحات. نفس نمط listing_events بالضبط: إدراج فقط عبر server fn
-- بصلاحية service-role (الزائر غالبًا بلا جلسة دخول أصلًا)، داخلي بالكامل — الوصول فقط من /hq.
CREATE TABLE public.site_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL,
  visitor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_visits_created_idx ON public.site_visits (created_at);
CREATE INDEX site_visits_visitor_idx ON public.site_visits (visitor_id);

ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_visits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.site_visits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.site_visits_id_seq TO service_role;
-- عمدًا بلا أي سياسة لـauthenticated/anon — لا قراءة ولا كتابة مباشرة، فقط عبر service-role من
-- trackSiteVisit (كتابة) وplatformSiteVisits (قراءة، بصلاحية "subscribers" بـ/hq).

-- تجميع (عدد فعلي + أشخاص فريدون) بدالة SQL واحدة بدل سحب كل الصفوف لجافاسكربت وعدّها هناك — يبقى
-- سريعًا مهما كبر الجدول. الوصول محصور بمنح التنفيذ لـservice_role فقط (نفس نمط orgs_of_user)،
-- فلا حاجة لأي فحص صلاحية داخل الدالة نفسها — لا يستدعيها غير كود الخادم الموثوق.
CREATE OR REPLACE FUNCTION public.site_visit_stats() RETURNS TABLE(
  total_visits bigint, unique_visitors bigint, visits_30d bigint, unique_visitors_30d bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM public.site_visits),
    (SELECT count(DISTINCT visitor_id) FROM public.site_visits),
    (SELECT count(*) FROM public.site_visits WHERE created_at >= now() - interval '30 days'),
    (SELECT count(DISTINCT visitor_id) FROM public.site_visits WHERE created_at >= now() - interval '30 days')
$$;
REVOKE ALL ON FUNCTION public.site_visit_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_visit_stats() TO service_role;
