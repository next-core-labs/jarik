-- Product decision 2026-11-11: publishing a unit on the website (سوق العروض) is FREE for offices.
-- Only an owner publishing a unit themselves pays (that flow is separate). An office's publication
-- has no end date: market_paid_until NULL with market_org_id set = a free office publication, shown
-- while the unit is vacant and that office is still the unit's office (same rule as before).
--
-- Based on the newest definitions in 20261107150000_owner_logic_listings.sql (guard_market_publish,
-- vacant_units_public — same columns). Replay-safe.

-- ── 1. Staff of the unit's office list it without paying ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.guard_market_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _office uuid; _property_org uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- The publication's office and period are never written by a signed-in user directly.
  IF TG_OP = 'INSERT' THEN
    NEW.market_paid_until := NULL;
    NEW.market_org_id := NULL;
  ELSE
    NEW.market_paid_until := OLD.market_paid_until;
    NEW.market_org_id := OLD.market_org_id;
  END IF;

  IF NOT NEW.market_listed THEN RETURN NEW; END IF;

  SELECT p.org_id, COALESCE(p.org_id, private.unit_agreement_org(NEW.id))
  INTO _property_org, _office
  FROM public.properties p WHERE p.id = NEW.property_id;

  -- Office staff (with `leasing` on an owner's unit under an agreement): free, no end date. A paid
  -- period of this same office that is still running is simply superseded.
  IF _office IS NOT NULL
     AND public.is_staff(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.org_members m
       WHERE m.org_id = _office AND m.user_id = auth.uid() AND m.kind = 'member'
     )
     AND (_property_org IS NOT NULL OR private.agreement_permission(NEW.id, _office, 'leasing')) THEN
    NEW.market_org_id := _office;
    NEW.market_paid_until := NULL;
    RETURN NEW;
  END IF;

  -- Anyone else newly listing a unit (an owner) needs a paid publication.
  IF TG_OP = 'INSERT' OR NOT OLD.market_listed THEN
    RAISE EXCEPTION 'نشر الوحدة في الموقع يتولاه مكتبها مجانًا — أو برسوم نشر للمالك'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ── 2. Office publications that were paid become free and stop expiring ────────────────────────
-- (runs with no auth.uid(), so the guard above lets it through)
UPDATE public.units
SET market_paid_until = NULL
WHERE market_org_id IS NOT NULL AND market_paid_until IS NOT NULL;

-- ── 3. Public listings: a free office publication (no end date) shows too ───────────────────────
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
  END AS list_price,
  u.furnishing,
  u.furniture,
  p.city
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = u.market_org_id
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published AND op.org_id = o.id
WHERE u.status = 'vacant' AND u.market_listed
  AND (u.market_paid_until IS NULL OR u.market_paid_until > now())
  AND u.market_org_id = COALESCE(p.org_id, private.unit_agreement_org(u.id));
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
