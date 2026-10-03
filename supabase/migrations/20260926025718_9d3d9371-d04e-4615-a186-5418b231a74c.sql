CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES org_settings(id) ON DELETE CASCADE,
  referred_name text NOT NULL,
  referred_phone text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','rewarded','declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "referrals_select_referrer" ON public.referrals
  FOR SELECT TO authenticated
  USING (referrer_id = auth.uid());

CREATE POLICY "referrals_select_org_staff" ON public.referrals
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = referrals.org_id
        AND m.user_id = auth.uid()
        AND m.kind = 'member'
    )
  );

CREATE POLICY "referrals_update_org_staff" ON public.referrals
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = referrals.org_id
        AND m.user_id = auth.uid()
        AND m.kind = 'member'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = referrals.org_id
        AND m.user_id = auth.uid()
        AND m.kind = 'member'
    )
  );