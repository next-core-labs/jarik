
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_channels ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;

DROP VIEW IF EXISTS public.office_pages_public;
CREATE VIEW public.office_pages_public WITH (security_invoker = true) AS
SELECT o.id, o.company_name, o.bio, o.logo_url, o.banner_path, o.city, o.district, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o WHERE o.listed_publicly AND o.verified;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.my_org_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND kind = 'member' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_org_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_org_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.register_office(_name text, _city text, _district text, _fal text, _phone text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid; _code text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'يجب تسجيل الدخول'; END IF;
  IF public.my_org_id() IS NOT NULL THEN RAISE EXCEPTION 'حسابك تابع لمكتب بالفعل'; END IF;
  IF length(trim(_name)) < 3 THEN RAISE EXCEPTION 'اسم المكتب قصير'; END IF;
  _code := upper(substr(regexp_replace(COALESCE(nullif(trim(_name),''), 'OFFICE'), '[^A-Za-z0-9]', '', 'g'), 1, 8));
  IF _code = '' THEN _code := 'OFFICE'; END IF;
  WHILE EXISTS (SELECT 1 FROM public.org_settings WHERE office_code = _code) LOOP
    _code := _code || floor(random() * 90 + 10)::text;
  END LOOP;
  INSERT INTO public.org_settings (company_name, city, district, fal_license_no, office_phone, office_code, listed_publicly, verified)
  VALUES (trim(_name), nullif(trim(_city),''), nullif(trim(_district),''), nullif(trim(_fal),''), nullif(trim(_phone),''), _code, true, false)
  RETURNING id INTO _org;
  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (_org, auth.uid(), 'member', 'staff', true);
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), 'staff')
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _org;
END $$;
REVOKE ALL ON FUNCTION public.register_office(text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_office(text, text, text, text, text) TO authenticated;

CREATE TABLE IF NOT EXISTS public.invoice_counters (
  year integer PRIMARY KEY,
  last_number integer NOT NULL DEFAULT 0
);
GRANT SELECT ON public.invoice_counters TO authenticated;
GRANT ALL ON public.invoice_counters TO service_role;
ALTER TABLE public.invoice_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff read counters" ON public.invoice_counters FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()));

CREATE OR REPLACE FUNCTION public.next_invoice_number(_year integer)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  INSERT INTO public.invoice_counters (year, last_number) VALUES (_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_number = invoice_counters.last_number + 1
  RETURNING last_number INTO n;
  RETURN 'INV-' || _year || '-' || lpad(n::text, 4, '0');
END $$;
REVOKE ALL ON FUNCTION public.next_invoice_number(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(integer) TO authenticated;
