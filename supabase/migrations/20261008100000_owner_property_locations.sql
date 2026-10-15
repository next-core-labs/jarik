-- Owner dashboard map: coordinates of every property that holds at least one of the caller's units.
-- properties_read only matches properties.owner_id, so a unit owned directly (units.owner_id) inside
-- someone else's building could not be placed on the owner's map. Same ownership rule as
-- owner_units(): COALESCE(units.owner_id, properties.owner_id). Only the location is exposed — no
-- address, deed or owner fields of a third party's property.
CREATE OR REPLACE FUNCTION public.owner_property_locations()
RETURNS TABLE(property_id uuid, lat double precision, lng double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT DISTINCT p.id, p.lat::double precision, p.lng::double precision
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
    AND p.lat IS NOT NULL AND p.lng IS NOT NULL
$$;

REVOKE ALL ON FUNCTION public.owner_property_locations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_property_locations() TO authenticated, service_role;
