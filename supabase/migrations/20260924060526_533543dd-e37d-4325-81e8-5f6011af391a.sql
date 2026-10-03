CREATE TABLE public.market_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  phone text NOT NULL,
  purpose text NOT NULL DEFAULT 'rent' CHECK (purpose IN ('rent', 'sale')),
  unit_type text,
  city text,
  district text,
  budget_min numeric,
  budget_max numeric,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX market_requests_status_created_idx ON public.market_requests (status, created_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.market_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION private.enforce_market_request_rate_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  recent_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('market_requests:' || NEW.phone));
  SELECT count(*) INTO recent_count FROM public.market_requests
  WHERE phone = NEW.phone AND created_at > now() - interval '1 hour';
  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'MARKET_REQUEST_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_rate_limit BEFORE INSERT ON public.market_requests
FOR EACH ROW EXECUTE FUNCTION private.enforce_market_request_rate_limit();

GRANT SELECT ON public.market_requests TO authenticated;
GRANT UPDATE (status) ON public.market_requests TO authenticated;
GRANT ALL ON public.market_requests TO service_role;

ALTER TABLE public.market_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY market_requests_staff_read ON public.market_requests
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

CREATE POLICY market_requests_staff_update ON public.market_requests
FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE VIEW public.market_requests_public AS
SELECT id, created_at, purpose, unit_type, city, district, budget_min, budget_max, notes
FROM public.market_requests
WHERE status = 'open' AND created_at > now() - interval '45 days';

GRANT SELECT ON public.market_requests_public TO anon, authenticated;