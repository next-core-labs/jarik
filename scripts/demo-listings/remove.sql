-- Removes everything scripts/demo-listings/add.sql created: the demo office's units, properties and the
-- office itself. Touches nothing else (all rows hang off the fixed demo office id).
--
--   supabase db query --linked -f scripts/demo-listings/remove.sql
WITH props AS (
  SELECT id FROM public.properties WHERE org_id = 'de300000-0000-4000-8000-000000000001'
),
gone_units AS (
  DELETE FROM public.units WHERE property_id IN (SELECT id FROM props) RETURNING id
),
gone_props AS (
  DELETE FROM public.properties WHERE id IN (SELECT id FROM props) RETURNING id
)
DELETE FROM public.org_settings
WHERE id = 'de300000-0000-4000-8000-000000000001'
  AND (SELECT count(*) FROM gone_units) >= 0
  AND (SELECT count(*) FROM gone_props) >= 0;
