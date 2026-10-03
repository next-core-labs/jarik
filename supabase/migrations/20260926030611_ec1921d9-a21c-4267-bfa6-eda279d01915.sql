ALTER TABLE public.units ADD COLUMN IF NOT EXISTS vacant_since timestamptz;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS auto_price_decay boolean NOT NULL DEFAULT false;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS price_floor numeric;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS price_decayed_at timestamptz;

UPDATE public.units SET vacant_since = now() WHERE status = 'vacant' AND vacant_since IS NULL;

CREATE OR REPLACE FUNCTION private.track_unit_vacant_since() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'vacant' AND OLD.status IS DISTINCT FROM 'vacant' THEN
    NEW.vacant_since := now();
    NEW.price_decayed_at := NULL;
  ELSIF NEW.status IS DISTINCT FROM 'vacant' THEN
    NEW.vacant_since := NULL;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS z_track_unit_vacant_since ON public.units;
CREATE TRIGGER z_track_unit_vacant_since BEFORE UPDATE OF status ON public.units
FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
EXECUTE FUNCTION private.track_unit_vacant_since();

CREATE OR REPLACE FUNCTION public.decay_vacant_unit_prices() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  new_price numeric;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT id, listing_purpose, annual_rent, sale_price, price_floor
    FROM public.units
    WHERE status = 'vacant' AND market_listed AND auto_price_decay
      AND price_floor IS NOT NULL
      AND vacant_since IS NOT NULL AND vacant_since <= now() - interval '14 days'
      AND (price_decayed_at IS NULL OR price_decayed_at <= now() - interval '7 days')
  LOOP
    IF r.listing_purpose = 'sale' THEN
      new_price := greatest(r.price_floor, round(r.sale_price * 0.98));
      IF new_price < r.sale_price THEN
        UPDATE public.units SET sale_price = new_price, price_decayed_at = now() WHERE id = r.id;
        PERFORM public.notify_unit(r.id, 'خُفِّض سعر وحدتك تلقائيًا',
          'انخفض سعر البيع إلى ' || to_char(new_price, 'FM999999999') || ' ريال لطول فترة العرض بلا اهتمام كافٍ.', 'unit');
        n := n + 1;
      END IF;
    ELSE
      new_price := greatest(r.price_floor, round(r.annual_rent * 0.98));
      IF new_price < r.annual_rent THEN
        UPDATE public.units SET annual_rent = new_price, price_decayed_at = now() WHERE id = r.id;
        PERFORM public.notify_unit(r.id, 'خُفِّض إيجار وحدتك تلقائيًا',
          'انخفض الإيجار السنوي إلى ' || to_char(new_price, 'FM999999999') || ' ريال لطول فترة العرض بلا اهتمام كافٍ.', 'unit');
        n := n + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.decay_vacant_unit_prices() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacant-price-decay') THEN
    PERFORM cron.schedule('vacant-price-decay', '0 6 * * *', 'SELECT public.decay_vacant_unit_prices()');
  END IF;
END $$;