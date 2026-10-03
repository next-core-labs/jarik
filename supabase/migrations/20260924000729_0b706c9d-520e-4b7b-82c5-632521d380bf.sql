
DROP VIEW IF EXISTS public.vacant_unit_photos_public;
DROP VIEW IF EXISTS public.owner_pages_public;
DROP VIEW IF EXISTS public.office_pages_public;
DROP VIEW IF EXISTS public.vacant_units_public;

CREATE VIEW public.vacant_units_public WITH (security_invoker = true) AS
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

CREATE VIEW public.vacant_unit_photos_public WITH (security_invoker = true) AS
SELECT ph.unit_id, ph.path, ph.position
FROM public.unit_photos ph
JOIN public.vacant_units_public v ON v.id = ph.unit_id;
GRANT SELECT ON public.vacant_unit_photos_public TO anon, authenticated;

CREATE VIEW public.owner_pages_public WITH (security_invoker = true) AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.phone, op.whatsapp,
  op.avatar_path,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op WHERE op.published;
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;

CREATE VIEW public.office_pages_public WITH (security_invoker = true) AS
SELECT o.id, o.company_name, o.bio, o.logo_url, o.banner_path, o.city, o.district, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o WHERE o.listed_publicly AND o.verified;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;
