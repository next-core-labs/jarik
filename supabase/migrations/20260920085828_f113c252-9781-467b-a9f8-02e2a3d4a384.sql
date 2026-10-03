CREATE POLICY documents_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'documents');
CREATE POLICY documents_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'documents' AND public.is_staff(auth.uid()));
CREATE POLICY documents_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'documents' AND public.is_staff(auth.uid()))
WITH CHECK (bucket_id = 'documents' AND public.is_staff(auth.uid()));
CREATE POLICY documents_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'documents' AND public.is_staff(auth.uid()));