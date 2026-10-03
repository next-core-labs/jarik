-- =============================================================================================
-- واجهة المكتب لاتفاقية الإدارة تحتاج تعرف "مين المالك" لطلب وارد (sent/office_modified) قبل ما
-- يقرر المكتب — لكن ما فيه علاقة org_members/org_clients بين المالك والمكتب بعد (هذا بالضبط أول
-- تواصل بينهم؛ اتفاقية الإدارة نفسها لا تُنشئ رابط "فريق/عميل" — علاقة منفصلة تمامًا). فـ
-- profiles_select (20260922110000: is_staff() AND may_link(id, my_org())) ترفض دائمًا هنا — حتى
-- بعد ما تصير الاتفاقية سارية. نفس نمط office_link_requests() بالضبط: دالة SECURITY DEFINER ضيقة
-- تتجاوز هذا فقط لعرض اسم/بريد مالك اتفاقية موجّهة فعليًا لمكتب المتصل، لا أي حساب آخر.
--
-- تفاصيل الوحدات (رقمها واسم عقارها) تُكشف فقط لو status='active' — لطلب لسه بانتظار رد المكتب
-- (sent/office_modified) يظهر عدد الوحدات فقط، بلا تفاصيلها (agreement_units_read/units_read لا
-- تكشفها للمكتب قبل قبوله الاتفاقية أصلًا، وهذا مقصود: لا داعي يشوف المكتب تفاصيل وحدات مالك لسه
-- ما وافق يديرها). بعد active، RLS العادية (20260924170000) تكشفها فعليًا عبر صلاحية 'view'
-- الضمنية، فتضمينها هنا مجرد تبسيط لاستعلام واحد بدل عدّة استعلامات بالواجهة.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.office_agreement_requests()
RETURNS TABLE (
  id uuid,
  owner_name text,
  owner_email text,
  status text,
  commission_type text,
  commission_value numeric,
  start_date date,
  end_date date,
  notice_period_days integer,
  maintenance_cap numeric,
  termination_requested_at timestamptz,
  termination_requested_by text,
  units_count bigint,
  units jsonb,
  permissions text[],
  created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := public.my_org_id();
BEGIN
  -- أي موظف من المكتب، لا مدير حصرًا — يطابق تمامًا صلاحية البتّ الفعلية في
  -- office_respond_agreement() (is_staff() + عضوية بالمكتب، بلا شرط is_office_manager).
  IF org IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه الشاشة لموظفي المكتب' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id, pr.full_name, u.email::text, a.status, a.commission_type, a.commission_value,
    a.start_date, a.end_date, a.notice_period_days, a.maintenance_cap,
    a.termination_requested_at, a.termination_requested_by,
    (SELECT count(*) FROM public.agreement_units au WHERE au.agreement_id = a.id),
    CASE WHEN a.status = 'active' THEN
      (SELECT coalesce(
        jsonb_agg(jsonb_build_object('unit_number', un.unit_number, 'property_name', p.name)), '[]'::jsonb)
       FROM public.agreement_units au
       JOIN public.units un ON un.id = au.unit_id
       JOIN public.properties p ON p.id = un.property_id
       WHERE au.agreement_id = a.id)
    ELSE '[]'::jsonb END,
    COALESCE(
      (SELECT array_agg(ap.permission) FROM public.agreement_permissions ap WHERE ap.agreement_id = a.id),
      '{}'),
    a.created_at
  FROM public.management_agreements a
  JOIN auth.users u ON u.id = a.owner_id
  LEFT JOIN public.profiles pr ON pr.id = a.owner_id
  -- 'rejected' مُضمَّنة أيضًا (لا 'cancelled' — تلك حالة نادرة قبل أي رد من المكتب) حتى تبقى شاشة
  -- المكتب مطابقة لشاشة المالك (owner.agreements.tsx تعرض تاريخها كاملًا بلا فلتر) بدل ما يختفي
  -- طلب رفضه المكتب توًا من كل مكان بلا أثر.
  WHERE a.org_id = org AND a.status IN ('sent', 'office_modified', 'active', 'rejected')
  ORDER BY (a.status = 'active') ASC, (a.status = 'rejected') ASC, a.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.office_agreement_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_agreement_requests() TO authenticated;

-- المالك يعرض اسم مكتب كل اتفاقية من اتفاقياته هو — office_directory (المستخدمة أصلًا كتضمين
-- FK مباشر) تكشف فقط المكاتب listed_publicly AND verified (20260922090000)، وorg_settings نفسها
-- مقصورة على أعضائها. لو مكتب أوقف الإدراج بالسوق أو فقد التوثيق لاحقًا، اتفاقية المالك السارية
-- الحقيقية معه تفقد اسم المكتب بلا سبب — رغم إن العلاقة التعاقدية حقيقية وقائمة. نفس نمط
-- office_agreement_requests(): SECURITY DEFINER ضيقة مقصورة على اتفاقيات المتصل نفسه فقط.
CREATE OR REPLACE FUNCTION public.my_agreement_offices() RETURNS TABLE (org_id uuid, company_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT a.org_id, o.company_name
  FROM public.management_agreements a
  JOIN public.org_settings o ON o.id = a.org_id
  WHERE a.owner_id = auth.uid()
$$;
REVOKE ALL ON FUNCTION public.my_agreement_offices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_agreement_offices() TO authenticated;
