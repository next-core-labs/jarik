-- The technician's job card opens the request's photo/audio through signed URLs, but
-- maintenance_media_read only allowed the uploader (own folder) and staff of the request's office.
-- Add the technician assigned to a non-cancelled job whose photo_path or audio_path is the file.
-- The helper is SECURITY DEFINER so the check doesn't go through maintenance_requests RLS.

CREATE OR REPLACE FUNCTION private.technician_media_ok(_name text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.maintenance_requests m
    WHERE m.technician_id = auth.uid()
      AND m.status <> 'cancelled'
      AND _name IN (m.photo_path, m.audio_path)
  )
$$;
REVOKE ALL ON FUNCTION private.technician_media_ok(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.technician_media_ok(text) TO authenticated, service_role;

-- Every existing branch from 20260922110000 is kept as is.
DROP POLICY IF EXISTS maintenance_media_read ON storage.objects;
CREATE POLICY maintenance_media_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'maintenance-media' AND (
  auth.uid()::text = (storage.foldername(name))[1]
  OR (public.is_staff(auth.uid()) AND EXISTS (
        SELECT 1 FROM public.maintenance_requests m
        WHERE m.org_id = private.my_org()
          AND objects.name IN (m.photo_path, m.audio_path)))
  OR private.technician_media_ok(name)));
