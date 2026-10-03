-- Per-user rate limiting for endpoints that spend money (the shared AI key) or fan out
-- notifications to every staff member. Fixed window counters, no extension required.
CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action, window_start)
);
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rate_limits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

-- Returns true while the caller is within `_max` calls per `_window_seconds`, false once over.
CREATE OR REPLACE FUNCTION public.check_rate_limit(_action text, _max integer, _window_seconds integer)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  win timestamptz;
  n integer;
BEGIN
  IF uid IS NULL THEN
    RETURN true; -- service role / internal callers are not limited
  END IF;
  IF _max < 1 OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate limit';
  END IF;
  win := to_timestamp(floor(extract(epoch FROM now()) / _window_seconds) * _window_seconds);

  INSERT INTO public.rate_limits (user_id, action, window_start, hits)
  VALUES (uid, _action, win, 1)
  ON CONFLICT (user_id, action, window_start)
  DO UPDATE SET hits = public.rate_limits.hits + 1
  RETURNING hits INTO n;

  -- Housekeeping: drop old windows now and then (about 1% of calls).
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE window_start < now() - interval '1 day';
  END IF;

  RETURN n <= _max;
END; $$;
REVOKE EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO authenticated, service_role;
