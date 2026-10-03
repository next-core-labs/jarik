DROP POLICY IF EXISTS "branding_read_authenticated" ON storage.objects;

CREATE POLICY "branding_read_scoped" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'branding'
  AND (
    (storage.foldername(name))[1] = ANY (
      SELECT o::text FROM unnest(public.orgs_of_user(auth.uid())) AS o
    )
    OR EXISTS (
      SELECT 1 FROM public.org_settings s
      WHERE s.id::text = (storage.foldername(name))[1]
        AND s.listed_publicly
    )
  )
);