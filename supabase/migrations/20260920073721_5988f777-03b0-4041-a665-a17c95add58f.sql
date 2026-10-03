ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS fal_license_no text,
  ADD COLUMN IF NOT EXISTS office_phone text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS listed_publicly boolean NOT NULL DEFAULT true;

CREATE OR REPLACE VIEW public.office_directory
WITH (security_barrier = true) AS
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

GRANT SELECT ON public.office_directory TO anon, authenticated;