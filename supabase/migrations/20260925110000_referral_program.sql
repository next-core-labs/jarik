-- نظام الإحالة: أي حساب (مالك أو مستأجر) له رمز إحالة شخصي، يشاركه، ومن يستخدمه عند تقديم طلب
-- وحدة عام يُسجَّل كإحالة معلّقة لدى مكتب ذلك الطلب. لا أتمتة مالية — المكافأة قرار المكتب اليدوي
-- بعد إغلاق الصفقة (تحديد الإحالة كـ"مكافأة" من شاشة المكتب).

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

CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_name text NOT NULL,
  referred_phone text,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rewarded', 'declined')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX referrals_referrer_idx ON public.referrals (referrer_id, created_at);
CREATE INDEX referrals_org_idx ON public.referrals (org_id);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.referrals FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.referrals TO authenticated;
GRANT ALL ON public.referrals TO service_role;

-- المُحيل يرى إحالاته هو فقط.
CREATE POLICY referrals_referrer_read ON public.referrals FOR SELECT TO authenticated
USING (referrer_id = auth.uid());
-- الموظف يرى إحالات مكتبه ويقرر حالتها (المكافأة قرار يدوي بعد إغلاق الصفقة فعليًا).
CREATE POLICY referrals_staff_read ON public.referrals FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));
CREATE POLICY referrals_staff_update ON public.referrals FOR UPDATE TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
-- نفس عزل المكاتب المعتمد بكل الجداول: يقيّد الموظف على مكتبه فقط، ولا يضيّق شيئًا على المُحيل
-- نفسه (staff_scope_ok ترجع true تلقائيًا لغير الموظفين).
CREATE POLICY org_isolation ON public.referrals AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

-- يرجّع رمز إحالة المستخدم الحالي، وينشئه أول مرة يُطلب فيها (6 خانات مشتقة من هويته + الوقت،
-- بمحاولة إعادة عند تصادم نادر مع رمز مستخدم آخر).
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
      -- else: the candidate collided with a DIFFERENT user's code — loop and mint another.
    END;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.my_referral_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_referral_code() TO authenticated;
