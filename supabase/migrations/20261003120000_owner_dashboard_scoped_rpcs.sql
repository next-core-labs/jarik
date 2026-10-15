-- Owner dashboard: every figure comes from these owner-scoped functions instead of client-side
-- sums over RLS-filtered tables. RLS alone gave the owner dashboard wrong numbers:
--   * an account that is also a tenant (or staff/technician) saw its own tenant payments and
--     maintenance mixed into the owner totals;
--   * a unit owned directly (units.owner_id) inside someone else's property was invisible, because
--     properties_read only matches properties.owner_id, while its payments still showed up;
--   * client-side sums over `payments` were silently capped at PostgREST's max-rows (1000);
--   * nothing ever writes payments.status = 'overdue', so overdue had to be derived from due_date.
-- Ownership everywhere below is the same rule as private.unit_owner():
-- COALESCE(units.owner_id, properties.owner_id).

-- 1) The caller's own units, with property and active-lease details.
CREATE OR REPLACE FUNCTION public.owner_units()
RETURNS TABLE(
  unit_id uuid, unit_number text, unit_type text, status text, annual_rent numeric,
  property_id uuid, property_name text, city text, district text,
  lease_id uuid, lease_end_date date, lease_annual_rent numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.unit_number, u.unit_type, u.status, u.annual_rent,
         p.id, p.name, p.city, COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         l.id, l.end_date, l.annual_rent
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  LEFT JOIN LATERAL (
    SELECT id, end_date, annual_rent FROM public.leases
    WHERE unit_id = u.id AND status = 'active'
    ORDER BY start_date DESC LIMIT 1
  ) l ON true
  WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ORDER BY p.created_at, p.name, u.unit_number
$$;

-- 2) Money: overdue, upcoming, trailing-12-month collections/expenses, last 6 months, recent rows.
CREATE OR REPLACE FUNCTION public.owner_finance_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  _since date := ((now() AT TIME ZONE 'Asia/Riyadh')::date - interval '12 months')::date;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  WITH owned AS (
    SELECT u.id AS unit_id, u.unit_number, p.name AS property_name
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    WHERE COALESCE(u.owner_id, p.owner_id) = _uid
  ),
  pay AS (
    SELECT pay.id, pay.amount, pay.due_date, pay.paid_date, pay.status, o.unit_number, o.property_name
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    JOIN owned o ON o.unit_id = l.unit_id
  ),
  exp AS (
    -- Unit-level expenses on the caller's units, plus property-level expenses (no unit) on
    -- properties the caller owns outright.
    SELECT e.amount, e.expense_date FROM public.expenses e
    WHERE e.unit_id IN (SELECT unit_id FROM owned)
       OR (e.unit_id IS NULL AND e.property_id IN (
             SELECT id FROM public.properties WHERE owner_id = _uid))
  )
  SELECT jsonb_build_object(
    'today', _today,
    'overdue_count', (SELECT count(*) FROM pay WHERE status <> 'paid' AND due_date < _today),
    'overdue_total', (SELECT COALESCE(sum(amount), 0) FROM pay WHERE status <> 'paid' AND due_date < _today),
    'upcoming_30_total', (SELECT COALESCE(sum(amount), 0) FROM pay
                           WHERE status <> 'paid' AND due_date BETWEEN _today AND _today + 30),
    'collected_12m', (SELECT COALESCE(sum(amount), 0) FROM pay
                       WHERE status = 'paid' AND COALESCE(paid_date, due_date) > _since),
    'expenses_12m', (SELECT COALESCE(sum(amount), 0) FROM exp WHERE expense_date > _since),
    'months', (
      SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'collected', COALESCE((
               SELECT sum(amount) FROM pay
               WHERE status = 'paid'
                 AND date_trunc('month', COALESCE(paid_date, due_date)::timestamp) = m), 0)) ORDER BY m)
      FROM generate_series(date_trunc('month', _today::timestamp) - interval '5 months',
                           date_trunc('month', _today::timestamp), interval '1 month') AS m
    ),
    'recent', COALESCE((
      SELECT jsonb_agg(r) FROM (
        SELECT id, amount, due_date, paid_date, status, unit_number, property_name
        FROM pay
        -- Activity up to today only: future scheduled instalments are not "recent payments".
        WHERE due_date <= _today OR status = 'paid'
        ORDER BY COALESCE(paid_date, due_date) DESC
        LIMIT 8
      ) r
    ), '[]'::jsonb)
  ) INTO _out;

  RETURN _out;
END;
$$;

-- 3) Per-property return over the trailing 12 months (replaces the dashboard's use of
--    owner_property_roi, which divided all-time net by current annual rent and grew every year).
CREATE OR REPLACE FUNCTION public.owner_property_returns()
RETURNS TABLE(
  property_id uuid, property_name text, units_count bigint, annual_rent numeric,
  collected_12m numeric, expenses_12m numeric, net_12m numeric, net_pct numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH params AS (
    SELECT ((now() AT TIME ZONE 'Asia/Riyadh')::date - interval '12 months')::date AS since
  ),
  owned AS (
    SELECT u.id AS unit_id, u.annual_rent, u.status, p.id AS property_id, p.name AS property_name,
           (p.owner_id = auth.uid()) AS owns_property
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ),
  per_property AS (
    SELECT o.property_id, o.property_name, bool_or(o.owns_property) AS owns_property,
           count(*) AS units_count,
           COALESCE(sum(o.annual_rent) FILTER (WHERE o.status <> 'sold'), 0) AS annual_rent
    FROM owned o GROUP BY o.property_id, o.property_name
  ),
  collected AS (
    SELECT o.property_id, sum(pay.amount) AS amount
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    JOIN owned o ON o.unit_id = l.unit_id, params
    WHERE pay.status = 'paid' AND COALESCE(pay.paid_date, pay.due_date) > params.since
    GROUP BY o.property_id
  ),
  spent AS (
    SELECT x.property_id, sum(x.amount) AS amount
    FROM (
      -- Unit-level expenses on the caller's units (property_id may be empty on these rows).
      SELECT o.property_id, e.amount, e.expense_date
      FROM public.expenses e JOIN owned o ON o.unit_id = e.unit_id
      UNION ALL
      -- Property-level expenses, only on properties the caller owns outright.
      SELECT pp.property_id, e.amount, e.expense_date
      FROM per_property pp
      JOIN public.expenses e ON e.property_id = pp.property_id AND e.unit_id IS NULL
      WHERE pp.owns_property
    ) x, params
    WHERE x.expense_date > params.since
    GROUP BY x.property_id
  )
  SELECT pp.property_id, pp.property_name, pp.units_count, pp.annual_rent,
         COALESCE(c.amount, 0), COALESCE(s.amount, 0),
         COALESCE(c.amount, 0) - COALESCE(s.amount, 0),
         CASE WHEN pp.annual_rent = 0 THEN 0
              ELSE round(100.0 * (COALESCE(c.amount, 0) - COALESCE(s.amount, 0)) / pp.annual_rent, 1)
         END
  FROM per_property pp
  LEFT JOIN collected c ON c.property_id = pp.property_id
  LEFT JOIN spent s ON s.property_id = pp.property_id
  ORDER BY 7 DESC
$$;

-- 4) Maintenance awaiting the caller's approval — only on units they own, so an owner who is also
--    a tenant/technician/staff no longer sees requests decideMaintenanceApproval would refuse.
CREATE OR REPLACE FUNCTION public.owner_pending_approvals()
RETURNS TABLE(
  id uuid, title text, description text, cost numeric, priority text, created_at timestamptz,
  unit_number text, property_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT m.id, m.title, m.description, m.cost, m.priority, m.created_at, u.unit_number, p.name
  FROM public.maintenance_requests m
  JOIN public.units u ON u.id = m.unit_id
  JOIN public.properties p ON p.id = u.property_id
  WHERE auth.uid() IS NOT NULL
    AND m.approval_status = 'pending'
    AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ORDER BY m.created_at
$$;

-- 5) The offices that actually manage the caller's units: each unit's property office, plus offices
--    holding an ACTIVE management agreement over one of them. Public identity fields only.
CREATE OR REPLACE FUNCTION public.owner_offices()
RETURNS TABLE(
  id uuid, company_name text, fal_license_no text, office_phone text,
  city text, district text, address text, logo_url text, units_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH links AS (
    SELECT p.org_id, u.id AS unit_id
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
      AND p.org_id IS NOT NULL
    UNION
    SELECT a.org_id, au.unit_id
    FROM public.management_agreements a
    JOIN public.agreement_units au ON au.agreement_id = a.id
    WHERE auth.uid() IS NOT NULL AND a.owner_id = auth.uid() AND a.status = 'active'
  )
  SELECT o.id, o.company_name, o.fal_license_no, o.office_phone, o.city, o.district, o.address,
         o.logo_url, count(DISTINCT l.unit_id)
  FROM links l JOIN public.org_settings o ON o.id = l.org_id
  GROUP BY o.id
  ORDER BY count(DISTINCT l.unit_id) DESC, o.company_name
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.owner_units()', 'public.owner_finance_summary()', 'public.owner_property_returns()',
    'public.owner_pending_approvals()', 'public.owner_offices()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- 6) Office logos: owners linked to an office only through a property or an active agreement (no
--    org_members row) could not read org_settings, so the branding download was refused and their
--    statement had no letterhead. Same condition as before, plus the caller's managing offices.
DROP POLICY IF EXISTS branding_read_authenticated ON storage.objects;
CREATE POLICY branding_read_authenticated ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'branding'
  AND (
    EXISTS (SELECT 1 FROM public.org_settings o WHERE o.id::text = split_part(name, '/', 1))
    OR split_part(name, '/', 1) IN (SELECT oo.id::text FROM public.owner_offices() oo)
  )
);
