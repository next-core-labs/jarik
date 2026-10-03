CREATE POLICY maintenance_media_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'maintenance-media' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY maintenance_media_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'maintenance-media' AND (
    public.is_staff(auth.uid()) OR auth.uid()::text = (storage.foldername(name))[1]
  ));
CREATE POLICY maintenance_media_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'maintenance-media' AND auth.uid()::text = (storage.foldername(name))[1]);