-- Backend for the public marketplace features in the Jark design (Jark Website mock):
--   1) «انخفض السعر 4%» — remember the price a listing had before the automatic vacant-price
--      decay (20260925130000_vacant_price_decay.sql) started cutting it, and expose it publicly.
--   2) Favourites (the heart) — a per-user list of saved listings.
--   3) «احجز عرضاً توضيحياً» — demo requests from the "for offices" section, read in /hq.

-- 1) Price before the automatic cuts --------------------------------------------------------------
-- list_price is the asking price the office/owner set themselves. It is filled the first time the
-- decay job lowers the price (the job always stamps price_decayed_at in the same UPDATE) and cleared
-- whenever a person sets a price again, the purpose changes, or the unit leaves the market, so a
-- drop is only ever shown against a price that was really asked.
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS list_price numeric;

CREATE OR REPLACE FUNCTION private.track_unit_list_price() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.listing_purpose IS DISTINCT FROM OLD.listing_purpose THEN
    NEW.list_price := NULL;
  ELSIF NEW.price_decayed_at IS NOT NULL
        AND NEW.price_decayed_at IS DISTINCT FROM OLD.price_decayed_at THEN
    -- An automatic cut: keep the first price, not the previous step.
    NEW.list_price := COALESCE(
      OLD.list_price,
      CASE WHEN OLD.listing_purpose = 'sale' THEN OLD.sale_price ELSE OLD.annual_rent END
    );
  ELSIF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent
        OR NEW.sale_price IS DISTINCT FROM OLD.sale_price THEN
    -- A person set the price: that is the new asking price, nothing to compare against.
    NEW.list_price := NULL;
  END IF;
  RETURN NEW;
END $$;

-- zz_ sorts after z_track_unit_vacant_since (which resets price_decayed_at on re-listing).
DROP TRIGGER IF EXISTS zz_track_unit_list_price ON public.units;
CREATE TRIGGER zz_track_unit_list_price
  BEFORE UPDATE OF annual_rent, sale_price, listing_purpose, price_decayed_at, status ON public.units
  FOR EACH ROW EXECUTE FUNCTION private.track_unit_list_price();

-- Same view as 20260927212822 plus list_price at the end (CREATE OR REPLACE VIEW may only append
-- columns). It is non-null only while the current price is really below it.
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
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id AND m.kind = 'member' LIMIT 1),
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id LIMIT 1),
  (SELECT s.id FROM public.org_settings s WHERE s.listed_publicly AND s.verified ORDER BY s.created_at LIMIT 1)
)
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- 2) Favourites ------------------------------------------------------------------------------------
-- Visitors who are signed out keep favourites in their browser; signing in merges them here.
CREATE TABLE IF NOT EXISTS public.listing_favorites (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, unit_id)
);
CREATE INDEX IF NOT EXISTS listing_favorites_unit_idx ON public.listing_favorites (unit_id);
GRANT SELECT, INSERT, DELETE ON public.listing_favorites TO authenticated;
GRANT ALL ON public.listing_favorites TO service_role;
ALTER TABLE public.listing_favorites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS listing_favorites_read_own ON public.listing_favorites;
CREATE POLICY listing_favorites_read_own ON public.listing_favorites FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Only listings that are on the public market can be saved (no probing of private unit ids), and at
-- most 500 per account.
DROP POLICY IF EXISTS listing_favorites_add_own ON public.listing_favorites;
CREATE POLICY listing_favorites_add_own ON public.listing_favorites FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.vacant_units_public v WHERE v.id = unit_id)
    AND (SELECT count(*) FROM public.listing_favorites f WHERE f.user_id = auth.uid()) < 500
  );

DROP POLICY IF EXISTS listing_favorites_remove_own ON public.listing_favorites;
CREATE POLICY listing_favorites_remove_own ON public.listing_favorites FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- 3) Demo requests ---------------------------------------------------------------------------------
-- Internal like platform_feedback: no grants to anon/authenticated. Writes go through the
-- submitDemoRequest server function (service role, rate-limited per phone); reads and status changes
-- through /hq server functions guarded by the "offices" permission.
CREATE TABLE IF NOT EXISTS public.demo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  phone text NOT NULL CHECK (phone ~ '^[0-9+ -]{9,15}$'),
  office_name text CHECK (office_name IS NULL OR char_length(office_name) <= 160),
  city text CHECK (city IS NULL OR char_length(city) <= 80),
  units_count integer CHECK (units_count IS NULL OR units_count BETWEEN 0 AND 100000),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 1000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS demo_requests_created_idx ON public.demo_requests (created_at DESC);
CREATE INDEX IF NOT EXISTS demo_requests_phone_idx ON public.demo_requests (phone, created_at DESC);
GRANT ALL ON public.demo_requests TO service_role;
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;
