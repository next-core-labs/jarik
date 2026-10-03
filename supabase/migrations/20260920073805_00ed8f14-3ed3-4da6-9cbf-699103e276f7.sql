DROP POLICY IF EXISTS branding_public_read ON storage.objects;
CREATE POLICY branding_public_read ON storage.objects
FOR SELECT TO anon
USING (bucket_id = 'branding');