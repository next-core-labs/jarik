-- Photos for the demo listings (run after add.sql; safe to re-run). The files live in the
-- listing-media bucket in each unit's folder (<unit id>/D<n>-<k>.jpg; required by the
-- unit_photos_path_in_unit_folder check) and are CC0 stock photos from StockSnap and rawpixel via
-- Openverse — generic interiors/exteriors, not the property advertised (credits: photos-credits.json).
-- Upload them first, one folder per unit:  supabase storage cp -r <dir>/<unit id> ss:///listing-media/ --linked --experimental
INSERT INTO public.unit_photos (unit_id, path, position)
SELECT u.id, u.id || '/D' || v.n || '-' || v.k || '.jpg', v.k - 1
FROM (VALUES
  (1, 1),
  (1, 2),
  (1, 3),
  (1, 4),
  (2, 1),
  (2, 2),
  (2, 3),
  (2, 4),
  (3, 1),
  (3, 2),
  (3, 3),
  (3, 4),
  (4, 1),
  (4, 2),
  (4, 3),
  (4, 4),
  (4, 5),
  (5, 1),
  (5, 2),
  (5, 3),
  (6, 1),
  (6, 2),
  (6, 3),
  (7, 1),
  (7, 2),
  (7, 3),
  (8, 1),
  (8, 2),
  (8, 3),
  (9, 1),
  (9, 2),
  (9, 3),
  (9, 4),
  (10, 1),
  (11, 1),
  (11, 2),
  (11, 3),
  (12, 1)
) AS v (n, k)
JOIN public.units u ON u.unit_number = 'D' || v.n
JOIN public.properties p ON p.id = u.property_id AND p.org_id = 'de300000-0000-4000-8000-000000000001'
WHERE NOT EXISTS (
  SELECT 1 FROM public.unit_photos ph WHERE ph.unit_id = u.id AND ph.path = u.id || '/D' || v.n || '-' || v.k || '.jpg'
);
