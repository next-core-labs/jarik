CREATE OR REPLACE FUNCTION public.office_agreement_requests()
RETURNS TABLE (
  id uuid, owner_name text, owner_email text, status text, commission_type text, commission_value numeric,
  start_date date, end_date date, notice_period_days integer, maintenance_cap numeric,
  termination_requested_at timestamptz, termination_requested_by text, units_count bigint,
  units jsonb, permissions text[], created_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := public.my_org_id();
BEGIN
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
  WHERE a.org_id = org AND a.status IN ('sent', 'office_modified', 'active')
  ORDER BY (a.status = 'active') ASC, a.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.office_agreement_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_agreement_requests() TO authenticated;