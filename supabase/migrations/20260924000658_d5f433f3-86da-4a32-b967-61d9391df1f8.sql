
-- org_settings: البيانات الكاملة (أرقام التواصل) للموظفين فقط؛ الجمهور يقرأ عبر العروض العامة
DROP POLICY IF EXISTS "org_settings read" ON public.org_settings;
DROP POLICY IF EXISTS "authenticated read org_settings" ON public.org_settings;
DROP POLICY IF EXISTS "org_settings_select" ON public.org_settings;
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='org_settings' AND cmd='SELECT' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.org_settings', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "staff read org_settings" ON public.org_settings FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = id AND m.user_id = auth.uid()));

-- unit_photos: الموظف أو مالك الوحدة فقط؛ صور العروض العامة تمر عبر vacant_unit_photos_public
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='unit_photos' AND cmd='SELECT' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.unit_photos', p.policyname);
  END LOOP;
END $$;
CREATE POLICY "staff or owner read unit photos" ON public.unit_photos FOR SELECT TO authenticated
  USING (public.is_staff(auth.uid()) OR EXISTS (SELECT 1 FROM public.units u WHERE u.id = unit_id AND u.owner_id = auth.uid()));
