-- Photos, listing details, owner pages and the public offers market («سوق العروض»).

-- 1) Listing fields shown to the public.
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS listing_description text;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS amenities text[] NOT NULL DEFAULT '{}';

-- 2) Which office manages a property. NULL means "the primary (oldest) office", so every existing
--    property keeps working. The public market used to join units to EVERY listed office, so with two
--    offices each unit showed up twice under the wrong office's name.
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS properties_org_idx ON public.properties (org_id);

-- 2b) The office's own public page: a short bio and a cover banner next to the logo/licence/phone that
--     the office identity screen already holds.
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS banner_path text;

-- 3) Photos. `position` 0 is the cover. The path must live inside the unit's own folder in the
--    bucket, so a row can never point at another unit's (or another bucket's) files.
CREATE TABLE IF NOT EXISTS public.unit_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  path text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, path),
  CONSTRAINT unit_photos_path_in_unit_folder CHECK (path LIKE unit_id::text || '/%' AND path NOT LIKE '%..%')
);
CREATE INDEX IF NOT EXISTS unit_photos_unit_idx ON public.unit_photos (unit_id, position);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.unit_photos TO authenticated;
GRANT ALL ON public.unit_photos TO service_role;
ALTER TABLE public.unit_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY unit_photos_staff_all ON public.unit_photos FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY unit_photos_owner_read ON public.unit_photos FOR SELECT TO authenticated
USING (private.unit_owner(unit_id) = auth.uid());

-- 4) Owner pages: the office builds a public page for each owner (name, photo, bio, contact) and
--    the owner's vacant units appear on it and in the market. Only staff can edit; nothing is public
--    until `published` is switched on.
CREATE TABLE IF NOT EXISTS public.owner_pages (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  bio text,
  areas text,
  property_types text,
  phone text,
  whatsapp text,
  avatar_path text,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT owner_pages_avatar_in_owner_folder
    CHECK (avatar_path IS NULL OR (avatar_path LIKE 'owners/' || owner_id::text || '/%' AND avatar_path NOT LIKE '%..%'))
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_pages TO authenticated;
GRANT ALL ON public.owner_pages TO service_role;
ALTER TABLE public.owner_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY owner_pages_staff_all ON public.owner_pages FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY owner_pages_self_read ON public.owner_pages FOR SELECT TO authenticated
USING (owner_id = auth.uid());
CREATE TRIGGER owner_pages_updated BEFORE UPDATE ON public.owner_pages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5) Public market view: the vacant units of publicly listed offices, attributed to the office that
--    manages the property, with the listing fields, cover photo and the owner page (if published).
--    Existing columns keep their order; new ones are appended so current consumers keep working.
CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street,
       u.floor_no, u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.furnished,
       o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
       o.city AS office_city, o.district AS office_district,
       u.listing_description, u.amenities, u.created_at,
       (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id
         ORDER BY ph.position, ph.created_at LIMIT 1) AS cover_path,
       (SELECT count(*)::integer FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
       o.id AS office_id,
       op.owner_id AS owner_page_id,
       op.display_name AS owner_name,
       op.avatar_path AS owner_avatar_path,
       COALESCE(NULLIF(op.phone, ''), o.office_phone) AS contact_phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), o.whatsapp_number, o.office_phone) AS contact_whatsapp
FROM public.units u
JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o
  ON o.listed_publicly
 AND o.id = COALESCE(p.org_id, (SELECT s.id FROM public.org_settings s ORDER BY s.created_at, s.id LIMIT 1))
LEFT JOIN public.owner_pages op
  ON op.published AND op.owner_id = COALESCE(u.owner_id, p.owner_id)
WHERE u.status = 'vacant';
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- Photos of the units above, for the gallery on a listing page.
CREATE OR REPLACE VIEW public.vacant_unit_photos_public AS
SELECT ph.id, ph.unit_id, ph.path, ph.position
FROM public.unit_photos ph
JOIN public.vacant_units_public v ON v.id = ph.unit_id;
GRANT SELECT ON public.vacant_unit_photos_public TO anon, authenticated;

-- Published owner pages only, with the office's number as a fallback contact.
CREATE OR REPLACE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.avatar_path,
       COALESCE(NULLIF(op.phone, ''), pri.office_phone) AS phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), pri.whatsapp_number, pri.office_phone) AS whatsapp,
       (SELECT count(*)::integer FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op
LEFT JOIN LATERAL (
  SELECT s.office_phone, s.whatsapp_number FROM public.org_settings s
  WHERE s.listed_publicly ORDER BY s.created_at, s.id LIMIT 1
) pri ON true
WHERE op.published;
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;

-- Publicly listed offices with their page content and how many offers they have on the market.
CREATE OR REPLACE VIEW public.office_pages_public AS
SELECT o.id, o.company_name, o.logo_url, o.banner_path, o.bio, o.fal_license_no,
       o.office_phone, o.whatsapp_number, o.city, o.district,
       (SELECT count(*)::integer FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o
WHERE o.listed_publicly;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;

-- 6) Storage. One public bucket for listing media (unit photos under <unit id>/, owner avatars under
--    owners/<owner id>/, office banners under offices/<office id>/); only staff can add, change or remove files. If this project does not allow
--    creating buckets from a migration the statement is skipped with a notice: create a PUBLIC bucket
--    named `listing-media` (5 MB limit; image/jpeg, image/png, image/webp) from the dashboard instead.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES ('listing-media', 'listing-media', true, 5242880, ARRAY['image/jpeg', 'image/png', 'image/webp'])
  ON CONFLICT (id) DO UPDATE
    SET public = true, file_size_limit = 5242880,
        allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not create the listing-media bucket (%). Create it manually as a public bucket.', SQLERRM;
END $$;

CREATE POLICY listing_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'listing-media');
CREATE POLICY listing_media_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'listing-media' AND public.is_staff(auth.uid()));
CREATE POLICY listing_media_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'listing-media' AND public.is_staff(auth.uid()))
WITH CHECK (bucket_id = 'listing-media' AND public.is_staff(auth.uid()));
CREATE POLICY listing_media_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'listing-media' AND public.is_staff(auth.uid()));
