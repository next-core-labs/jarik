-- =============================================================================================
-- market_stats() averaged annual_rent and counted occupancy across EVERY unit in a district,
-- including units for sale (listing_purpose = 'sale'), whose annual_rent is always 0. A district
-- with a few listed or sold properties therefore got a falsely low average rent and a falsely low
-- occupancy percentage — shown to owners in their neighbourhood market report (portal.tsx) and
-- fed directly into the AI rent suggestion (pricing.functions.ts: suggestRent), which would then
-- suggest a rent skewed down by properties that were never rentals to begin with.
--
-- Fix: the rental market's statistics are about the rental market. A unit for sale (whatever its
-- current status — still listed, or already sold) never belonged in that average.
--
-- Deliberately platform-wide, not office-scoped (matches this function's actual live definition,
-- 20260920082609_...sql): market_stats() is a cross-office market benchmark ("what's typical in
-- this district"), not one office's own portfolio stats — scoping it to the caller's office would
-- defeat its purpose. An earlier draft of this fix added `private.user_in_org(auth.uid(), org_id)`
-- to WHERE, assuming a helper from a migration chain that was never actually applied to this live
-- database (confirmed: `private.user_in_org` does not exist live) — removed before this could ever
-- be pasted into Lovable's chat and fail outright.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS TABLE(district text, units_count bigint, avg_rent numeric, occupancy_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         count(*), round(avg(u.annual_rent)),
         round(100.0 * count(*) FILTER (WHERE u.status = 'occupied') / count(*))
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  WHERE u.listing_purpose <> 'sale'
  GROUP BY 1 ORDER BY 1
$$;
