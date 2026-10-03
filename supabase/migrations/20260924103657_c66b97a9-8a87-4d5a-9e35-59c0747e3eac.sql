-- unit_requests: public submissions stay open but cannot forge ownership or skip required fields
DROP POLICY IF EXISTS unit_requests_anon_insert ON public.unit_requests;
CREATE POLICY unit_requests_anon_insert ON public.unit_requests
FOR INSERT TO anon, authenticated
WITH CHECK (
  (created_by IS NULL OR created_by = auth.uid())
  AND length(coalesce(full_name, '')) BETWEEN 1 AND 200
  AND length(coalesce(phone, '')) BETWEEN 5 AND 30
  AND length(coalesce(notes, '')) <= 2000
);

-- office_reviews: only reviews of existing offices are readable
DROP POLICY IF EXISTS office_reviews_read ON public.office_reviews;
CREATE POLICY office_reviews_read ON public.office_reviews
FOR SELECT TO anon, authenticated
USING (office_id IS NOT NULL AND rating BETWEEN 1 AND 5);

-- owner_pages: signed-in users see only published pages (phone included) or their own / staff
DROP POLICY IF EXISTS "anyone signed in reads owner pages" ON public.owner_pages;
CREATE POLICY "read published or own owner pages" ON public.owner_pages
FOR SELECT TO authenticated
USING (published = true OR owner_id = auth.uid() OR public.is_staff(auth.uid()));

-- unit-photos: only staff or the unit owner can download
DROP POLICY IF EXISTS unit_photos_obj_read ON storage.objects;
CREATE POLICY unit_photos_obj_read ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'unit-photos'
  AND (public.is_staff(auth.uid())
       OR private.unit_owner((NULLIF(split_part(name, '/', 1), ''))::uuid) = auth.uid())
);

-- branding: no anonymous downloads; signed-in users only for offices they can see
DROP POLICY IF EXISTS branding_public_read ON storage.objects;
DROP POLICY IF EXISTS branding_read_authenticated ON storage.objects;
CREATE POLICY branding_read_authenticated ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'branding'
  AND EXISTS (SELECT 1 FROM public.org_settings o WHERE o.id::text = split_part(name, '/', 1))
);