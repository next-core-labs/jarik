-- Reconcile a from-scratch replay with the schema the app was built against (the old Lovable-hosted
-- database, mirrored by src/integrations/supabase/types.ts).
--
-- 20260922090000 made org_id NOT NULL on office-owned tables and fills it with the a_fill_org
-- trigger. The old database never had that constraint, and the app inserts these rows without
-- org_id (the trigger still fills it). Relax the constraint so the schema — and the generated
-- types — match what the app expects. The fill triggers and org_isolation policies are unchanged.

-- owner_pages: 20260922110000 re-keyed it on (org_id, owner_id); the old database (and the app's
-- upsert, one public page per owner) key it on owner_id.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
             WHERE i.indrelid = 'public.owner_pages'::regclass AND i.indisprimary AND a.attname = 'org_id') THEN
    ALTER TABLE public.owner_pages DROP CONSTRAINT owner_pages_pkey;
    ALTER TABLE public.owner_pages ADD CONSTRAINT owner_pages_pkey PRIMARY KEY (owner_id);
  END IF;
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['deals', 'expenses', 'invoices', 'maintenance_requests', 'owner_pages',
                           'properties', 'tenants', 'unit_requests', 'whatsapp_channels', 'whatsapp_messages']
  LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_schema = 'public' AND table_name = t AND column_name = 'org_id' AND is_nullable = 'NO') THEN
      EXECUTE format('ALTER TABLE public.%I ALTER COLUMN org_id DROP NOT NULL', t);
    END IF;
  END LOOP;
END $$;

-- Office verification stays platform-only, but HQ verifies offices through
-- hq_set_office_verified() as the signed-in user: accept the same roles that function accepts
-- (super admin, or an HQ admin with the "offices" permission), in addition to admin.
CREATE OR REPLACE FUNCTION public.guard_org_verified() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.verified IS DISTINCT FROM OLD.verified
     AND auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'super_admin')
     AND NOT EXISTS (
       SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'offices' = ANY(permissions)
     ) THEN
    RAISE EXCEPTION 'اعتماد المكتب من إدارة المنصة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
