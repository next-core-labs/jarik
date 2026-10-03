-- =============================================================================================
-- إصلاح ثغرة حرجة مؤكدة (مراجعة عدائية على واجهات اتفاقية الإدارة، لُقطت وهي مُطبَّقة بالفعل على
-- القاعدة الحية ضمن management_agreements_foundation): سياسات القراءة الأربع على
-- management_agreements/agreement_units/agreement_permissions/agreement_change_requests تتحقق من
-- عضوية org_members بلا فلتر kind='member' — فأي "عميل" (مالك أو مستأجر مرتبط بمكتب لسبب غير
-- متعلق بهذي الاتفاقية إطلاقًا، عبر office_link_client أو الربط الذاتي) يمرّ من هذا الشرط
-- بالضبط متل موظف حقيقي بالمكتب، فيشوف كل اتفاقيات ذاك المكتب مع كل الملاك الآخرين — تسريب
-- بيانات حقيقي بين ملاك مختلفين، من نفس فئة الثغرة اللي 20260924110000 عالجتها أصلًا لكن بجداول
-- مختلفة، وهي بالضبط الفخ اللي حارس guard_technician تنبّه له لاحقًا (تعليق "إصلاح: ثغرة حرجة #6"
-- بملف 20260924170000). لا تغيير آخر على منطق أي سياسة — فقط إضافة "AND m.kind = 'member'".
-- =============================================================================================

DROP POLICY IF EXISTS management_agreements_read ON public.management_agreements;
CREATE POLICY management_agreements_read ON public.management_agreements FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = management_agreements.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
  )
);

DROP POLICY IF EXISTS agreement_units_read ON public.agreement_units;
CREATE POLICY agreement_units_read ON public.agreement_units FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_units.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.org_members m
             WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
           ))
  )
);

DROP POLICY IF EXISTS agreement_permissions_read ON public.agreement_permissions;
CREATE POLICY agreement_permissions_read ON public.agreement_permissions FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_permissions.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.org_members m
             WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
           ))
  )
);

DROP POLICY IF EXISTS agreement_change_requests_read ON public.agreement_change_requests;
CREATE POLICY agreement_change_requests_read ON public.agreement_change_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_change_requests.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.org_members m
             WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
           ))
  )
);
