DROP VIEW IF EXISTS public.office_directory;

CREATE VIEW public.office_directory
WITH (security_invoker = true) AS
SELECT
  id,
  company_name,
  office_code,
  fal_license_no,
  office_phone,
  city,
  district,
  logo_url
FROM public.org_settings
WHERE listed_publicly;

GRANT SELECT (id, company_name, office_code, fal_license_no, office_phone, city, district, logo_url)
  ON public.org_settings TO anon;
GRANT SELECT ON public.office_directory TO anon, authenticated;

DROP POLICY IF EXISTS org_settings_public_directory ON public.org_settings;
CREATE POLICY org_settings_public_directory ON public.org_settings
FOR SELECT TO anon
USING (listed_publicly);