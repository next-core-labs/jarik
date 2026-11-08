-- A title deed (صك ملكية) doesn't expire: what the office records for it is its ISSUE date. Other
-- documents (licences, insurance, FAL) keep their expiry date, which drives the 60-day warning.
ALTER TABLE public.property_documents ADD COLUMN IF NOT EXISTS issued_at date;

-- Deeds saved before this had their only date in expires_at — it was meant as the issue date.
UPDATE public.property_documents
SET issued_at = COALESCE(issued_at, expires_at), expires_at = NULL
WHERE kind = 'deed' AND expires_at IS NOT NULL;
