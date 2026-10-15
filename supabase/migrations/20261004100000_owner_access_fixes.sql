-- Follow-up to the owner-dashboard review (2026-10-04). Forward-only.

-- 1) org_settings: "staff read org_settings" (20260924000658) was `is_staff(...) OR <member of the
--    office>`, so ANY office's staff could read EVERY office's settings row (VAT/CR numbers, rates,
--    WhatsApp lock, approval threshold…). Membership alone is the right rule: an office's own staff
--    are org_members of it, and every cross-office read in the app already goes through the service
--    role or a SECURITY DEFINER view/function (office_directory, office_pages_public,
--    vacant_units_public, owner_offices()), none of which depend on this policy.
DROP POLICY IF EXISTS "staff read org_settings" ON public.org_settings;
CREATE POLICY "members read org_settings" ON public.org_settings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = id AND m.user_id = auth.uid()));

-- 2) request_management_agreement checked ownership through the property only
--    (properties.owner_id). A property owner could therefore sign a management agreement over a
--    unit that belongs to someone else (units.owner_id), and that unit's real owner could not sign
--    one at all. Same rule as private.unit_owner(): the unit's own owner, else the property's.
--    Body otherwise unchanged from 20260924160000_management_agreements_foundation.sql.
CREATE OR REPLACE FUNCTION public.request_management_agreement(
  _org_id uuid, _unit_ids uuid[], _commission_type text, _commission_value numeric,
  _start_date date, _end_date date, _notice_period_days integer, _maintenance_cap numeric,
  _permissions text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE agreement_id uuid; uid uuid := auth.uid(); uid_check uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF _unit_ids IS NULL OR array_length(_unit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'اختر وحدة واحدة على الأقل' USING ERRCODE = '22023';
  END IF;

  -- كل وحدة لازم تكون فعلاً مملوكة لمن يطلب — مالك الوحدة نفسها، وإلا مالك عقارها.
  SELECT u.id INTO uid_check
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = ANY(_unit_ids) AND COALESCE(u.owner_id, p.owner_id) IS DISTINCT FROM uid
  LIMIT 1;
  IF uid_check IS NOT NULL THEN
    RAISE EXCEPTION 'إحدى الوحدات ليست مملوكة لك' USING ERRCODE = '42501';
  END IF;

  -- ولا وحدة منها لها اتفاقية سارية حاليًا (مع أي مكتب) — الطلبات المعلّقة لمكاتب أخرى مسموحة.
  IF EXISTS (
    SELECT 1 FROM public.agreement_units au
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE au.unit_id = ANY(_unit_ids) AND a.status = 'active'
      AND (a.termination_requested_at IS NULL
           OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  ) THEN
    RAISE EXCEPTION 'إحدى الوحدات لها اتفاقية سارية بالفعل' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.management_agreements
    (org_id, owner_id, status, initiated_by, commission_type, commission_value,
     start_date, end_date, notice_period_days, maintenance_cap)
  VALUES
    (_org_id, uid, 'sent', 'owner', _commission_type, _commission_value,
     _start_date, _end_date, COALESCE(_notice_period_days, 30), _maintenance_cap)
  RETURNING id INTO agreement_id;

  INSERT INTO public.agreement_units (agreement_id, unit_id)
  SELECT agreement_id, u FROM unnest(_unit_ids) AS u;

  IF _permissions IS NOT NULL THEN
    INSERT INTO public.agreement_permissions (agreement_id, permission)
    SELECT agreement_id, p FROM unnest(_permissions) AS p;
  END IF;

  RETURN agreement_id;
END $$;
REVOKE ALL ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[]) TO authenticated;

-- 3) audit_log_owner_read had the same property-only rule for units, leases and maintenance: a
--    property owner read the history of units they don't own, the units' real owners read none.
DROP POLICY IF EXISTS audit_log_owner_read ON public.audit_log;
CREATE POLICY audit_log_owner_read ON public.audit_log FOR SELECT TO authenticated USING (
  CASE table_name
    WHEN 'properties' THEN EXISTS (
      SELECT 1 FROM public.properties p WHERE p.id = row_id AND p.owner_id = auth.uid())
    WHEN 'units' THEN private.unit_owner(row_id) = auth.uid()
    WHEN 'leases' THEN EXISTS (
      SELECT 1 FROM public.leases l WHERE l.id = row_id AND private.unit_owner(l.unit_id) = auth.uid())
    WHEN 'maintenance_requests' THEN EXISTS (
      SELECT 1 FROM public.maintenance_requests mr
      WHERE mr.id = row_id AND private.unit_owner(mr.unit_id) = auth.uid())
    ELSE false
  END
);

-- 4) Backfill for the approval bug fixed in maintenance.tsx: the office screen only asked for owner
--    approval when units.owner_id was set, so requests on units owned through their property were
--    saved as 'not_required' whatever their cost. Re-open the ones that would have needed approval
--    and where work has NOT started yet (status 'new') — anything in progress or done is left
--    alone, since asking for approval after the fact would mean nothing. Same cap the office screen
--    uses: the active agreement's cap, else the office threshold, else the UI default of 2000.
--    (guard_maintenance_columns lets this through: auth.uid() is NULL inside a migration.)
UPDATE public.maintenance_requests m
SET approval_status = 'pending'
FROM public.units u
JOIN public.properties p ON p.id = u.property_id
WHERE m.unit_id = u.id
  AND u.owner_id IS NULL
  AND p.owner_id IS NOT NULL
  AND m.approval_status = 'not_required'
  AND m.status = 'new'
  AND m.cost > COALESCE(public.effective_maintenance_cap(m.unit_id, m.org_id), 2000);
