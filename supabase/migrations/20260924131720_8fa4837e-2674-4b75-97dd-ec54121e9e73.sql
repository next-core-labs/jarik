CREATE TABLE public.tenant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tenant_invites_email_pending_idx ON public.tenant_invites (email) WHERE used_at IS NULL;
GRANT ALL ON public.tenant_invites TO service_role;
ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;