-- نفس علة "شعارات المكاتب" المُصلَحة بـ20260928105625 بالضبط: سياسة "members see their org" على
-- org_members كانت تستدعي public.orgs_of_user(auth.uid()) مباشرة — تلك الدالة صلاحية تنفيذها
-- لـservice_role فقط (REVOKE ALL ... FROM PUBLIC, anon, authenticated بـ20260924000346)، فأي قراءة
-- تلمس هذا الشرط فعليًا (حساب مرتبط بأكثر من مكتب، لا يغطّيه org_members_read الموازية المبنية على
-- private.my_org() أحادية المكتب) كانت تفشل بخطأ "permission denied for function orgs_of_user".
-- التصحيح: استبدال الاستدعاء المباشر بـpublic.my_org_ids() (الدالة الوسيطة المصرَّح تنفيذها لـ
-- authenticated، أُنشئت بالترحيل السابق) — بلا أي تغيير على منطق السياسة نفسه.
DROP POLICY IF EXISTS "members see their org" ON public.org_members;
CREATE POLICY "members see their org" ON public.org_members
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR org_id = ANY (public.my_org_ids()));
