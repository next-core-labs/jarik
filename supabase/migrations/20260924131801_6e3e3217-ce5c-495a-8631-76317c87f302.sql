CREATE TABLE public.building_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX building_announcements_property_idx ON public.building_announcements (property_id, created_at DESC);
DROP TRIGGER IF EXISTS set_updated_at_building_announcements ON public.building_announcements;
CREATE TRIGGER set_updated_at_building_announcements BEFORE UPDATE ON public.building_announcements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON public.building_announcements TO authenticated;
GRANT ALL ON public.building_announcements TO service_role;
ALTER TABLE public.building_announcements ENABLE ROW LEVEL SECURITY;

-- موظفو مكتب العقار يديرون إعلاناته.
CREATE POLICY building_announcements_staff_all ON public.building_announcements FOR ALL TO authenticated
USING (
  public.is_staff(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = building_announcements.property_id
      AND p.org_id = public.my_org_id()
  )
)
WITH CHECK (
  public.is_staff(auth.uid())
  AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.id = building_announcements.property_id
      AND p.org_id = public.my_org_id()
  )
);

-- المستأجر يقرأ إعلانات عقار له عقد على وحدة فيه.
CREATE POLICY building_announcements_tenant_read ON public.building_announcements FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.units u ON u.id = l.unit_id
    JOIN public.tenants t ON t.id = l.tenant_id
    WHERE u.property_id = building_announcements.property_id
      AND t.user_id = auth.uid()
  )
);