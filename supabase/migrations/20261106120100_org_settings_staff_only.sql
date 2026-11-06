-- QA 2026-11-05 (owner-dashboard P1): a linked owner could read their office's whole org_settings
-- row (VAT/CR numbers, utility rates, approval threshold, Ejar broker id, WhatsApp settings, office
-- code…). "members read org_settings" (20261004100000) admitted every org_members row, and owners
-- and tenants linked to an office are org_members too, with kind = 'client'. Only the office's own
-- people (kind = 'member': staff and technicians) may read the row. The service role and the
-- SECURITY DEFINER views/functions (office_directory, office_pages_public, vacant_units_public,
-- owner_offices(), hq_*) do not depend on this policy and are unchanged. Forward-only.

-- 1) Read: the office's own members only.
DROP POLICY IF EXISTS "members read org_settings" ON public.org_settings;
CREATE POLICY "members read org_settings" ON public.org_settings FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = org_settings.id AND m.user_id = auth.uid() AND m.kind = 'member'
  ));

-- 2) org_write (20260922090000) is FOR ALL, so it also grants SELECT. private.is_org_member() does
--    not look at kind, so an account that is staff of one office and a client of another could read
--    and edit the other office's settings. Same rule as above; office staff are unaffected.
DROP POLICY IF EXISTS org_write ON public.org_settings;
CREATE POLICY org_write ON public.org_settings FOR ALL TO authenticated
USING (public.is_staff(auth.uid()) AND EXISTS (
  SELECT 1 FROM public.org_members m
  WHERE m.org_id = org_settings.id AND m.user_id = auth.uid() AND m.kind = 'member'
))
WITH CHECK (public.is_staff(auth.uid()) AND EXISTS (
  SELECT 1 FROM public.org_members m
  WHERE m.org_id = org_settings.id AND m.user_id = auth.uid() AND m.kind = 'member'
));

-- 3) What owners and tenants still need: the identity card of the offices they are linked to (name,
--    logo, FAL licence, phone, location), shown on /portal, /tenant-dashboard and on their receipt
--    and statement PDFs (useOrgBranding). Same offices the old policy showed them, public fields
--    only, oldest office first (the order the client used).
CREATE OR REPLACE FUNCTION public.my_linked_offices()
RETURNS TABLE(
  id uuid, company_name text, fal_license_no text, office_phone text,
  city text, district text, address text, logo_url text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id, o.company_name, o.fal_license_no, o.office_phone, o.city, o.district, o.address,
         o.logo_url
  FROM public.org_settings o
  WHERE auth.uid() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = o.id AND m.user_id = auth.uid())
  ORDER BY o.created_at
$$;
REVOKE ALL ON FUNCTION public.my_linked_offices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_linked_offices() TO authenticated;
