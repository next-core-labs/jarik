-- =============================================================================================
-- ربط public.effective_maintenance_cap() (من 20260924160000) فعليًا بمنطق الموافقة على تكلفة
-- الصيانة — كانت موجودة بالقاعدة بلا أي استدعاء من التطبيق (كود ميت): شاشة الصيانة
-- (src/routes/_authenticated/maintenance.tsx) كانت تقرأ org_settings.owner_approval_threshold
-- مباشرة كحدّ ثابت واحد لكل المكتب، بصرف النظر عن أي اتفاقية إدارة سارية على وحدة معيّنة قد
-- تحدّد سقفًا مختلفًا (maintenance_cap على management_agreements).
--
-- هذي بالذات ثغرة سلوك حقيقية بسيناريو تعدد المكاتب: لو مكتب B يدير وحدة تابعة أصلًا لمكتب A
-- (عبر اتفاقية إدارة سارية بصلاحية 'maintenance')، الحد المعروض والمُطبَّق فعليًا كان حد مكتب B
-- الافتراضي (owner_approval_threshold عبر my_org_id() الخاص بـB) على كل الوحدات اللي يشوفها B —
-- بما فيها وحدات A — بلا أي اعتبار لسقف الاتفاقية الخاص بتلك الوحدة تحديدًا.
--
-- effective_maintenance_cap(unit_id, org_id) قائمة تُرجع قيمة واحدة (unit_id, org_id) — الشاشة
-- تعرض عدة صفوف بعدة وحدات دفعة وحدة، فدالة جماعية هنا أفضل من استدعاء RPC منفصل لكل صف.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.effective_maintenance_caps(_unit_ids uuid[], _org_id uuid)
RETURNS TABLE (unit_id uuid, cap numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT uid, public.effective_maintenance_cap(uid, _org_id)
  FROM unnest(_unit_ids) AS uid
$$;
REVOKE ALL ON FUNCTION public.effective_maintenance_caps(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_maintenance_caps(uuid[], uuid) TO authenticated, service_role;
