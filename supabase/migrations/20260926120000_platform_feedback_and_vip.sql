-- المرحلة 5 (الأخيرة) من لوحة "المدير العام": تقييم/اقتراح/شكوى عن المنصة من أي حساب في أي لوحة
-- تحكم (خانة "المساعدة" بالشريط الجانبي)، وعلامة VIP يضعها مالك الموقع أو مدير مفوَّض على أي مشترك
-- بناءً على عملياته الكبيرة — كلاهما يُقرآن من تبويب "التقييمات والشكاوى" الجديد بـ/hq.
--
-- platform_feedback داخلي بالكامل (نفس نمط platform_commissions) — الكتابة فقط عبر submit_feedback
-- (SECURITY DEFINER، بمعدّل محدود)، لا سياسة INSERT/SELECT مباشرة لـauthenticated، والقراءة فقط من
-- دوال الخادم عبر service-role.
CREATE TABLE public.platform_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (category IN ('rating', 'suggestion', 'complaint')),
  rating smallint CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  message text NOT NULL CHECK (char_length(btrim(message)) > 0 AND char_length(message) <= 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_feedback_created_idx ON public.platform_feedback (created_at DESC);

GRANT ALL ON public.platform_feedback TO service_role;
ALTER TABLE public.platform_feedback ENABLE ROW LEVEL SECURITY;
-- عمدًا بلا أي سياسة/منح لـauthenticated أو anon — الكتابة فقط عبر submit_feedback أدناه، والقراءة
-- فقط من دوال الخادم عبر service-role.

CREATE OR REPLACE FUNCTION public.submit_feedback(_category text, _rating integer, _message text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF _category NOT IN ('rating', 'suggestion', 'complaint') THEN
    RAISE EXCEPTION 'نوع غير معروف' USING ERRCODE = '22023';
  END IF;
  IF _rating IS NOT NULL AND (_rating < 1 OR _rating > 5) THEN
    RAISE EXCEPTION 'التقييم من 1 إلى 5' USING ERRCODE = '22023';
  END IF;
  IF _message IS NULL OR char_length(btrim(_message)) = 0 THEN
    RAISE EXCEPTION 'اكتب رسالة' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('submit-feedback', 10, 3600) THEN
    RAISE EXCEPTION 'محاولات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.platform_feedback (user_id, category, rating, message)
  VALUES (auth.uid(), _category, _rating, btrim(_message));
END $$;
REVOKE ALL ON FUNCTION public.submit_feedback(text, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_feedback(text, integer, text) TO authenticated;

-- علامة VIP — لازم تُقفل بمنح على مستوى العمود، لأن profiles_update الحالية تسمح لأي حساب بتعديل
-- صفه الخاص (id = auth.uid()) بلا قيد على أي عمود؛ لو تُرك vip ضمنها لقدر أي حساب يرفع علمه لنفسه.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS vip boolean NOT NULL DEFAULT false;
REVOKE UPDATE (vip) ON public.profiles FROM authenticated;

-- يضع/يزيل علامة VIP عن مشترك. مالك الموقع أو مدير مفوَّض بصلاحية reviews فقط.
CREATE OR REPLACE FUNCTION public.set_subscriber_vip(_user_id uuid, _vip boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hq_admins a
      WHERE a.user_id = auth.uid() AND 'reviews' = ANY(a.permissions)
    )
  ) THEN
    RAISE EXCEPTION 'هذه الصلاحية لمالك الموقع أو المدراء المفوَّضين بصلاحية التقييمات فقط'
      USING ERRCODE = '42501';
  END IF;
  UPDATE public.profiles SET vip = _vip WHERE id = _user_id;
END $$;
REVOKE ALL ON FUNCTION public.set_subscriber_vip(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_subscriber_vip(uuid, boolean) TO authenticated;
