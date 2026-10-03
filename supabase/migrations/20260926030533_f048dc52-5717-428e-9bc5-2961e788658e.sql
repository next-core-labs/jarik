CREATE TABLE public.referral_codes (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.referral_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referral_codes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.referral_codes TO authenticated;
GRANT ALL ON public.referral_codes TO service_role;
CREATE POLICY referral_codes_own_read ON public.referral_codes FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.my_referral_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  existing text;
  candidate text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT code INTO existing FROM public.referral_codes WHERE user_id = uid;
  IF existing IS NOT NULL THEN RETURN existing; END IF;

  LOOP
    candidate := upper(substr(md5(uid::text || clock_timestamp()::text), 1, 6));
    BEGIN
      INSERT INTO public.referral_codes (user_id, code) VALUES (uid, candidate);
      RETURN candidate;
    EXCEPTION WHEN unique_violation THEN
      SELECT code INTO existing FROM public.referral_codes WHERE user_id = uid;
      IF existing IS NOT NULL THEN RETURN existing; END IF;
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.my_referral_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_code() TO authenticated;

-- مواءمة جدول referrals المُنشأ سابقًا مع التصميم الكامل
ALTER TABLE public.referrals ALTER COLUMN org_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS referrals_referrer_idx ON public.referrals (referrer_id, created_at);
CREATE INDEX IF NOT EXISTS referrals_org_idx ON public.referrals (org_id);

DROP POLICY IF EXISTS referrals_select_referrer ON public.referrals;
DROP POLICY IF EXISTS referrals_select_org_staff ON public.referrals;
DROP POLICY IF EXISTS referrals_update_org_staff ON public.referrals;

CREATE POLICY referrals_referrer_read ON public.referrals FOR SELECT TO authenticated
USING (referrer_id = auth.uid());
CREATE POLICY referrals_staff_read ON public.referrals FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));
CREATE POLICY referrals_staff_update ON public.referrals FOR UPDATE TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY org_isolation ON public.referrals AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));