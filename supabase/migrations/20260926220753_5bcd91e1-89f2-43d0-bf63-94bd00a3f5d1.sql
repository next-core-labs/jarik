CREATE TABLE public.platform_commissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'collected')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  collected_at timestamptz
);
CREATE INDEX platform_commissions_org_idx ON public.platform_commissions (org_id);

GRANT ALL ON public.platform_commissions TO service_role;
ALTER TABLE public.platform_commissions ENABLE ROW LEVEL SECURITY;