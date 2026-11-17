-- الإصلاح الجذري لعطل سوق العروض 2026-11-18 («permission denied for function agreement_permission»):
-- في Postgres، ملكية الـVIEW تغطي صلاحيات الجداول المذكورة فيها فقط — أما الدوال فتُفحص بصلاحيات
-- المستعلم نفسه. شرط vacant_units_public هو «p.org_id IS NOT NULL OR private.agreement_permission(…)»،
-- فما دامت كل الوحدات المنشورة تابعة لعقارات مكاتب لا تُستدعى الدالة أصلًا والسوق يعمل؛ وأول ما
-- نُشرت وحدة لعقار مملوك مباشرة (p.org_id IS NULL) صارت تُقيَّم لكل صف، والزائر (anon) ممنوع منها
-- منذ تقوية 2026-09-24 — فانكسرت القراءة العامة كلها (السوق، /prices، صفحات الوحدات، والخريطة).
--
-- الدالتان SECURITY DEFINER تعيدان boolean/uuid فقط، فمنح تنفيذهما للزائر آمن ولا يكشف صفوفًا:
-- هذا بالضبط ما تحتاجه القراءة عبر الـVIEW، وبقية دوال private تبقى ممنوعة كما هي.
GRANT EXECUTE ON FUNCTION private.agreement_permission(uuid, uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION private.unit_agreement_org(uuid) TO anon, authenticated;
