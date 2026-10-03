CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS TABLE(district text, units_count bigint, avg_rent numeric, occupancy_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد') AS district,
    count(*) AS units_count,
    round(avg(u.annual_rent)) AS avg_rent,
    round(100.0 * count(*) FILTER (WHERE u.status = 'occupied') / count(*)) AS occupancy_pct
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  GROUP BY 1
  ORDER BY 1;
$$;

REVOKE EXECUTE ON FUNCTION public.market_stats() FROM anon;
GRANT EXECUTE ON FUNCTION public.market_stats() TO authenticated;