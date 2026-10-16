-- إصلاح 3 ثغرات كشفتها مراجعة كود شاملة (2026-09-29):
--
-- 1) owner_pages_public فقدت شرط توثيق المكتب (verified) اللي عندها office_pages_public — صفحة
--    مالك بمكتب غير موثَّق (أو أُلغي توثيقه لاحقًا) تبقى تظهر عامة بمحرك البحث رغم كذا.
-- 2) market_stats() كانت ترجع إحصاءات كل المكاتب بالمنصة لأي حساب مسجَّل دخول (مالك/مستأجر/موظف
--    أي مكتب) بدل مكتبه هو بس. الإصلاح الأصلي (20260922110000) كان يقيّدها بـprivate.user_in_org()،
--    لكن ترحيلًا لاحقًا (20260924100000) أزال القيد بدعوى إن الدالة "غير موجودة بقاعدة البيانات
--    الحية" — الدالة موجودة فعليًا بسلسلة الترحيلات ولم تُحذف بأي ترحيل، فنعيد تعريفها هنا احتياطًا
--    (idempotent، بلا أي تغيير بسلوكها) قبل استخدامها، ونعيد تقييد الدالة.
-- 3) audit_log: سياسة العزل RESTRICTIVE (org_isolation) الرابطة بـstaff_scope_ok/org_id موجودة
--    أصلًا بالترحيل الأول (20260922090000) ولم تُحذف — نعيد تأكيدها هنا صراحة احتياطًا من أي انحراف
--    فعلي بقاعدة البيانات الحية عن سلسلة الترحيلات (نفس الشك اللي دفع ترحيلات لاحقة "لإعادة" عمود
--    org_id رغم إضافته أصلًا بنفس الترحيل).

-- 1) owner_pages_public: يظهر فقط لو عند المالك عقار/وحدة تحت مكتب موثَّق ومُدرَج علنًا — نفس شرط
-- office_pages_public تمامًا، بدل الاعتماد فقط على published بجدول owner_pages.
-- Replay-safe: an earlier definition orders the columns differently, which REPLACE can't change.
DROP VIEW IF EXISTS public.owner_pages_public;
CREATE OR REPLACE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.avatar_path,
       COALESCE(NULLIF(op.phone, ''), pri.office_phone) AS phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), pri.whatsapp_number, pri.office_phone) AS whatsapp,
       (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op
LEFT JOIN LATERAL (
  SELECT s.office_phone, s.whatsapp_number FROM public.org_settings s
  WHERE s.listed_publicly ORDER BY s.created_at, s.id LIMIT 1
) pri ON true
WHERE op.published
  AND EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.org_settings o ON o.id = p.org_id AND o.listed_publicly AND o.verified
    WHERE p.owner_id = op.owner_id
    UNION ALL
    SELECT 1 FROM public.units u
    JOIN public.properties p2 ON p2.id = u.property_id
    JOIN public.org_settings o2 ON o2.id = p2.org_id AND o2.listed_publicly AND o2.verified
    WHERE u.owner_id = op.owner_id
  );
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;

-- 2) market_stats(): تقييد بمكتب/مكاتب الحساب المتصل فقط. كل من يستدعيها بالكود (owner-dashboard،
-- portal، pricing.functions) حساب موثَّق دخوله دومًا (requireSupabaseAuth/route محمي)، فلا كسر
-- لأي مسار عام مجهول.
CREATE OR REPLACE FUNCTION private.user_in_org(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _org IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.properties WHERE owner_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
               WHERE u.owner_id = _uid AND p.org_id = _org)
    OR EXISTS (SELECT 1 FROM public.tenants WHERE user_id = _uid AND org_id = _org)
  )
$$;
REVOKE EXECUTE ON FUNCTION private.user_in_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_in_org(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS TABLE(district text, units_count bigint, avg_rent numeric, occupancy_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         count(*), round(avg(u.annual_rent)),
         round(100.0 * count(*) FILTER (WHERE u.status = 'occupied') / count(*))
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  WHERE u.listing_purpose <> 'sale'
    AND private.user_in_org(auth.uid(), p.org_id)
  GROUP BY 1 ORDER BY 1
$$;

-- 3) audit_log: إعادة تأكيد صريحة لسياسة العزل RESTRICTIVE — idempotent، بلا أي تغيير عن حالتها لو
-- كانت موجودة أصلًا.
DROP POLICY IF EXISTS org_isolation ON public.audit_log;
CREATE POLICY org_isolation ON public.audit_log AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
