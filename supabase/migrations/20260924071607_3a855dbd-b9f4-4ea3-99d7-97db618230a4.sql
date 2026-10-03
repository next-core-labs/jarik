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

CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS TABLE(district text, units_count bigint, avg_rent numeric, occupancy_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         count(*), round(avg(u.annual_rent)),
         round(100.0 * count(*) FILTER (WHERE u.status = 'occupied') / count(*))
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  WHERE u.listing_purpose <> 'sale'
  GROUP BY 1 ORDER BY 1
$$;