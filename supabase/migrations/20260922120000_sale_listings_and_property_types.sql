-- =============================================================================================
-- The market carried rentals only. A Saudi real-estate office also sells: land, villas, palaces,
-- farms, rest houses, shops. This adds the missing half.
--
--   units.listing_purpose  'rent' | 'sale'   (everything that exists today is a rental)
--   units.sale_price       the asking price, used instead of annual_rent when purpose = 'sale'
--   unit_requests.purpose  what the visitor is after, so a buyer's request is not read as a tenant's
-- =============================================================================================

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS listing_purpose text NOT NULL DEFAULT 'rent',
  ADD COLUMN IF NOT EXISTS sale_price numeric NOT NULL DEFAULT 0;

DO $$
BEGIN
  ALTER TABLE public.units
    ADD CONSTRAINT units_listing_purpose_check CHECK (listing_purpose IN ('rent', 'sale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.units ADD CONSTRAINT units_sale_price_check CHECK (sale_price >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS units_listing_purpose_idx ON public.units (listing_purpose);

ALTER TABLE public.unit_requests
  ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'rent';

DO $$
BEGIN
  ALTER TABLE public.unit_requests
    ADD CONSTRAINT unit_requests_purpose_check CHECK (purpose IN ('rent', 'sale'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- A unit offered for sale must carry a price, and a rental must carry a rent. Left NOT VALID so
-- the rows that already exist are not judged by a rule that did not exist when they were written.
DO $$
BEGIN
  ALTER TABLE public.units ADD CONSTRAINT units_price_matches_purpose
    CHECK (listing_purpose <> 'sale' OR sale_price > 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------------------------
-- The public market view carries the purpose and both prices, so a search can ask for either.
-- A unit is still only offered while its status is 'vacant': that is how an office takes a sold
-- or rented unit off the market.
-- ---------------------------------------------------------------------------------------------
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
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), o.whatsapp_number, o.office_phone) AS contact_whatsapp,
       -- Appended, not inserted: CREATE OR REPLACE VIEW may only add columns at the end, and
       -- renaming an existing one by shifting the list is an error, not a silent change.
       COALESCE(u.listing_purpose, 'rent') AS listing_purpose,
       COALESCE(u.sale_price, 0) AS sale_price
FROM public.units u
JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.id = p.org_id AND o.listed_publicly AND o.verified
LEFT JOIN public.owner_pages op
  ON op.published AND op.org_id = o.id AND op.owner_id = COALESCE(u.owner_id, p.owner_id)
WHERE u.status = 'vacant';

-- Recreating the view resets its grants, and section 11 of the previous migration made the public
-- views read-only for clients. Keep it that way.
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.vacant_units_public FROM anon, authenticated;
