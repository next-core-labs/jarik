-- Product decision 2026-11-07: take the demo listings («إعلان تجريبي», scripts/demo-listings/add.sql)
-- off the public market now, instead of giving them the 30 days that 20261107150000 grants every
-- legacy unpaid listing. Only the fixed demo office's units are touched; the rows stay, so
-- scripts/demo-listings/remove.sql can still delete everything, or the units can be listed again.
-- Runs as the migration owner (no auth.uid()), so the publish guards let it through. Replay-safe.
UPDATE public.units u
SET market_listed = false,
    market_paid_until = NULL,
    market_org_id = NULL,
    auto_price_decay = false
FROM public.properties p
WHERE p.id = u.property_id
  AND p.org_id = 'de300000-0000-4000-8000-000000000001'
  AND (u.market_listed OR u.market_paid_until IS NOT NULL OR u.market_org_id IS NOT NULL);
