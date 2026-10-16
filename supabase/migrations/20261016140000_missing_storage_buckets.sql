-- The buckets behind office branding, property documents and maintenance media were created by
-- hand on the old Lovable project and never captured in a migration, so the new project has none
-- of them: logo/cover uploads, document uploads and tenant photo/voice notes all fail with
-- "Bucket not found". Their storage.objects policies already exist (20260920062103,
-- 20260922090000, 20260922110000, 20261016130300); this only creates the buckets.
--
-- branding is public: logos and covers are shown on public office pages through getPublicUrl.
-- documents and maintenance-media stay private and are opened through signed URLs.
-- ON CONFLICT DO NOTHING leaves any bucket that was already created by hand untouched.
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  VALUES
    ('branding', 'branding', true, 5242880,
     ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('documents', 'documents', false, 10485760,
     ARRAY['application/pdf', 'image/*']),
    -- No MIME list: voice notes arrive as e.g. "audio/webm;codecs=opus" or "audio/mp4" depending
    -- on the browser, and the read/insert policies already limit who can touch these objects.
    ('maintenance-media', 'maintenance-media', false, 10485760, NULL)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not create storage buckets (%). Create branding (public), documents and maintenance-media (private) manually.', SQLERRM;
END $$;
