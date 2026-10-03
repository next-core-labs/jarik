CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT
  u.id,
  u.unit_number,
  u.unit_name,
  u.unit_type,
  u.district,
  u.street,
  u.floor_no,
  u.rooms,
  u.halls,
  u.bathrooms,
  u.area,
  u.annual_rent,
  u.furnished,
  o.company_name,
  o.logo_url,
  o.fal_license_no,
  o.office_phone,
  o.whatsapp_number,
  o.city AS office_city,
  o.district AS office_district
FROM public.units u
JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly
WHERE u.status = 'vacant';

GRANT SELECT ON public.vacant_units_public TO anon;
GRANT SELECT ON public.vacant_units_public TO authenticated;
GRANT SELECT ON public.vacant_units_public TO service_role;