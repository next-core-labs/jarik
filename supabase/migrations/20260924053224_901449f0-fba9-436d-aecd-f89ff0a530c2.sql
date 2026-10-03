-- =============================================================================================
-- CRITICAL: the office system (org_members / org_settings.verified / register_office / ...)
-- currently built in this database lets any signed-in account register a second office and then
-- read, edit and delete every OTHER office's properties, units, leases, tenants, payments and
-- invoices — because the only access rule on those tables is "is this account staff at all"
-- (public.is_staff(auth.uid())), with no per-office scoping whatsoever.
--
-- This migration adds ONE additional RESTRICTIVE policy per business table: staff access is
-- additionally required to belong (via org_members, kind='member') to the SAME office as the row.
-- It changes nothing about how owners or tenants already see their own data — it only closes the
-- staff-to-staff cross-office hole.
-- =============================================================================================
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS properties_org_id_idx ON public.properties (org_id);
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS deals_org_id_idx ON public.deals (org_id);
CREATE OR REPLACE FUNCTION private.primary_org() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.org_settings ORDER BY created_at LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.primary_org() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.primary_org() TO service_role;
UPDATE public.properties SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.deals SET org_id = private.primary_org() WHERE org_id IS NULL;
CREATE OR REPLACE FUNCTION private.fill_property_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := COALESCE(public.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_fill_org ON public.properties;
CREATE TRIGGER a_fill_org BEFORE INSERT ON public.properties
FOR EACH ROW EXECUTE FUNCTION private.fill_property_org();
CREATE OR REPLACE FUNCTION private.org_of_property(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.properties WHERE id = _id
$$;
CREATE OR REPLACE FUNCTION private.org_of_unit(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.org_id FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE u.id = _id
$$;
CREATE OR REPLACE FUNCTION private.org_of_lease(_id uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT p.org_id FROM public.leases l
  JOIN public.units u ON u.id = l.unit_id JOIN public.properties p ON p.id = u.property_id
  WHERE l.id = _id
$$;
CREATE OR REPLACE FUNCTION private.fill_deal_org() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.org_id IS NULL THEN
    NEW.org_id := COALESCE(
      private.org_of_property(NEW.property_id),
      (SELECT m.org_id FROM public.org_members m WHERE m.user_id = NEW.assigned_to AND m.kind = 'member' LIMIT 1),
      public.my_org(), private.primary_org());
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a_fill_org ON public.deals;
CREATE TRIGGER a_fill_org BEFORE INSERT ON public.deals
FOR EACH ROW EXECUTE FUNCTION private.fill_deal_org();
REVOKE ALL ON FUNCTION private.org_of_property(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.org_of_unit(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.org_of_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.org_of_property(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.org_of_unit(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.org_of_lease(uuid) TO authenticated, service_role;
CREATE OR REPLACE FUNCTION private.staff_scope_ok(_org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT public.is_staff(auth.uid())
      OR (_org IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.org_members m
            WHERE m.user_id = auth.uid() AND m.org_id = _org AND m.kind = 'member'))
$$;
REVOKE ALL ON FUNCTION private.staff_scope_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.staff_scope_ok(uuid) TO authenticated, service_role;
DROP POLICY IF EXISTS org_isolation ON public.properties;
CREATE POLICY org_isolation ON public.properties AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
DROP POLICY IF EXISTS org_isolation ON public.units;
CREATE POLICY org_isolation ON public.units AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id)));
DROP POLICY IF EXISTS org_isolation ON public.leases;
CREATE POLICY org_isolation ON public.leases AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_unit(unit_id)));
DROP POLICY IF EXISTS org_isolation ON public.payments;
CREATE POLICY org_isolation ON public.payments AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_lease(lease_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_lease(lease_id)));
DROP POLICY IF EXISTS org_isolation ON public.invoices;
CREATE POLICY org_isolation ON public.invoices AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(private.org_of_lease(lease_id)))
WITH CHECK (private.staff_scope_ok(private.org_of_lease(lease_id)));
DROP POLICY IF EXISTS org_isolation ON public.expenses;
CREATE POLICY org_isolation ON public.expenses AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.org_of_unit(unit_id))))
WITH CHECK (private.staff_scope_ok(COALESCE(private.org_of_property(property_id), private.org_of_unit(unit_id))));
DROP POLICY IF EXISTS org_isolation ON public.deals;
CREATE POLICY org_isolation ON public.deals AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
DROP POLICY IF EXISTS org_isolation ON public.tenants;
CREATE POLICY org_isolation ON public.tenants AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
DROP POLICY IF EXISTS org_isolation ON public.maintenance_requests;
CREATE POLICY org_isolation ON public.maintenance_requests AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
DROP POLICY IF EXISTS org_isolation ON public.whatsapp_channels;
CREATE POLICY org_isolation ON public.whatsapp_channels AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
DROP POLICY IF EXISTS org_isolation ON public.whatsapp_messages;
CREATE POLICY org_isolation ON public.whatsapp_messages AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
DROP POLICY IF EXISTS org_isolation ON public.unit_requests;
CREATE POLICY org_isolation ON public.unit_requests AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
UPDATE public.tenants SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.maintenance_requests SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.whatsapp_channels SET org_id = private.primary_org() WHERE org_id IS NULL;
UPDATE public.unit_requests SET org_id = private.primary_org() WHERE org_id IS NULL;
-- ============================ الإصلاح الثاني: فراغ السوق العام للزوار ============================
DROP VIEW IF EXISTS public.vacant_unit_photos_public;
DROP VIEW IF EXISTS public.owner_pages_public;
DROP VIEW IF EXISTS public.office_pages_public;
DROP VIEW IF EXISTS public.vacant_units_public;
CREATE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp
FROM public.units u
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = COALESCE(
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id AND m.kind = 'member' LIMIT 1),
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id LIMIT 1),
  (SELECT s.id FROM public.org_settings s WHERE s.listed_publicly AND s.verified ORDER BY s.created_at LIMIT 1)
)
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
CREATE VIEW public.vacant_unit_photos_public AS
SELECT ph.unit_id, ph.path, ph.position
FROM public.unit_photos ph
JOIN public.vacant_units_public v ON v.id = ph.unit_id;
GRANT SELECT ON public.vacant_unit_photos_public TO anon, authenticated;
CREATE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.phone, op.whatsapp,
  op.avatar_path,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op WHERE op.published;
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;
CREATE VIEW public.office_pages_public AS
SELECT o.id, o.company_name, o.bio, o.logo_url, o.banner_path, o.city, o.district, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o WHERE o.listed_publicly AND o.verified;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;