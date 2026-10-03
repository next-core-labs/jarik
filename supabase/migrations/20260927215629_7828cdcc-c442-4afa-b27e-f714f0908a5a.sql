DROP POLICY IF EXISTS avatars_read ON storage.objects;
CREATE POLICY avatars_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = (auth.uid())::text);

DROP POLICY IF EXISTS branding_read_scoped ON storage.objects;
CREATE POLICY branding_read_scoped ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'branding' AND (storage.foldername(name))[1] IN (
  SELECT o::text FROM unnest(public.orgs_of_user(auth.uid())) AS o));

DROP POLICY IF EXISTS platform_settings_read ON public.platform_settings;
REVOKE SELECT ON public.platform_settings FROM anon;
CREATE POLICY platform_settings_read ON public.platform_settings FOR SELECT TO authenticated
USING (auth.uid() IS NOT NULL);