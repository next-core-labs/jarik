-- owner_property_returns divided the 12-month net by the asking rent of every non-sold unit, so a
-- vacant unit's asking rent diluted the return (13.6% instead of 25% in QA). Base annual_rent on
-- the contracted rent of each unit's current active lease, exactly as owner_units() and the
-- dashboard hero (model.contractedRent) do. Vacant units add 0. Return type and grants unchanged.
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
    SELECT u.id AS unit_id, l.annual_rent AS lease_annual_rent, p.id AS property_id,
           p.name AS property_name, (p.owner_id = auth.uid()) AS owns_property
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (
      SELECT annual_rent FROM public.leases
      WHERE unit_id = u.id AND status = 'active'
      ORDER BY start_date DESC LIMIT 1
    ) l ON true
    WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ),
  per_property AS (
    SELECT o.property_id, o.property_name, bool_or(o.owns_property) AS owns_property,
           count(*) AS units_count,
           COALESCE(sum(o.lease_annual_rent), 0) AS annual_rent
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
