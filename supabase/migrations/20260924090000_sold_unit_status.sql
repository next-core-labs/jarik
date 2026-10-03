-- =============================================================================================
-- A unit for sale needed a way to leave the market once it sells. Before this, taking a unit off
-- the market meant setting status='occupied', which is wrong (nobody occupies it) and also wrong
-- for reports that count 'occupied' as a rented unit.
--
-- Adds a fourth status, 'sold', and updates sync_unit_status so an active lease still always wins
-- (it means the unit is being rented, whatever it was marked before), but the absence of a lease
-- no longer forces a sold unit back to 'vacant'.
-- =============================================================================================

DO $$
BEGIN
  ALTER TABLE public.units ADD CONSTRAINT units_status_check
    CHECK (status IN ('vacant', 'occupied', 'maintenance', 'sold')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.sync_unit_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.units SET status = CASE
    WHEN EXISTS (SELECT 1 FROM public.leases l
                 WHERE l.unit_id = COALESCE(NEW.unit_id, OLD.unit_id) AND l.status = 'active')
      THEN 'occupied'
    WHEN status = 'sold' THEN 'sold'
    ELSE 'vacant' END
  WHERE id = COALESCE(NEW.unit_id, OLD.unit_id);
  RETURN NULL;
END; $$;

-- A unit for sale must never carry a rental lease: this trigger only tracks vacant/occupied/sold
-- correctly because a lease can never land on a 'sale' unit in the first place. Without this, a
-- lease created against a unit marked 'sold' and later ended would fall back to 'vacant' (the
-- CASE above has no memory of "sold" once status has moved to 'occupied') and silently reappear
-- on the public market.
CREATE OR REPLACE FUNCTION private.guard_no_lease_on_sale_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.units u WHERE u.id = NEW.unit_id AND u.listing_purpose = 'sale') THEN
    RAISE EXCEPTION 'لا يمكن إنشاء عقد إيجار على وحدة مطروحة للبيع' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_no_lease_on_sale_unit() FROM PUBLIC;
DROP TRIGGER IF EXISTS z_guard_no_lease_on_sale_unit ON public.leases;
CREATE TRIGGER z_guard_no_lease_on_sale_unit BEFORE INSERT OR UPDATE ON public.leases
FOR EACH ROW EXECUTE FUNCTION private.guard_no_lease_on_sale_unit();
