-- A public listing belongs to the office that manages its property (properties.org_id, always set by
-- the a_fill_org trigger). The view used to resolve the office from the unit owner's org_members row
-- only, and fell back to the oldest verified office — so a unit saved with «بدون مالك», or whose owner
-- is a client of several offices, was advertised under another office's name, phone and FAL licence.
--
-- Same columns as 20261015100000_marketplace_design_features.sql; only the office join changes. The
-- owner-based lookups stay as a fallback for any property that somehow has no org_id.
CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp,
  round(p.lat::numeric, 2) AS lat, round(p.lng::numeric, 2) AS lng,
  u.featured,
  CASE
    WHEN u.list_price > CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END
    THEN u.list_price
  END AS list_price
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = COALESCE(
  p.org_id,
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id AND m.kind = 'member' LIMIT 1),
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id LIMIT 1),
  (SELECT s.id FROM public.org_settings s WHERE s.listed_publicly AND s.verified ORDER BY s.created_at LIMIT 1)
)
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
