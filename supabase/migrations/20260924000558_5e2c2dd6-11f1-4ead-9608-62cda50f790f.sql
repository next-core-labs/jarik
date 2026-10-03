
ALTER TABLE public.unit_requests ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.unit_requests ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.rate_limits (
  user_id uuid NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, action, window_start)
);
GRANT ALL ON public.rate_limits TO service_role;
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.check_rate_limit(_action text, _max integer, _window_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _ws timestamptz; _c integer;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  _ws := to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);
  INSERT INTO public.rate_limits (user_id, action, window_start, count)
  VALUES (_uid, _action, _ws, 1)
  ON CONFLICT (user_id, action, window_start) DO UPDATE SET count = rate_limits.count + 1
  RETURNING count INTO _c;
  IF _c > _max THEN RAISE EXCEPTION 'تجاوزت الحد المسموح من الطلبات — جرّب بعد قليل'; END IF;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, integer, integer) TO authenticated;
