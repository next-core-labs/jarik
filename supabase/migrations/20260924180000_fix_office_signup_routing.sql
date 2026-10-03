-- =============================================================================================
-- إصلاح: حساب يسجّل باختيار "مكتب" من /auth كان يُمنح تلقائيًا دور 'tenant' (كل قيمة غير 'owner'
-- في assign_default_role() كانت تسقط على 'tenant' الافتراضي)، فيُحوَّل مباشرة للوحة المستأجر —
-- ولا يصل أبدًا لشاشة «تسجيل مكتب عقاري» أصلًا: حتى لو ما أُعطي أي دور، تلك الشاشة لم تكن ضمن
-- NON_STAFF_ALLOWED_PATHS في route.tsx، فحارس المسار كان يردّه فورًا لمسار آخر قبل ما تُعرض له.
--
-- بهذا الإصلاح: اختيار 'office' لا يمنح أي دور تلقائي (الدور 'admin' يُمنح لاحقًا من register_office()
-- نفسها بعد إكمال بيانات المكتب)، وحارس المسار يوجّه الحساب بلا دور الذي اختار 'office' وقت
-- التسجيل مباشرة لشاشة التسجيل بدل صفحة "بدون دور" الميتة.
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.assign_default_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_count integer; chosen text;
BEGIN
  SELECT count(*) INTO existing_count FROM public.user_roles;
  IF existing_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  chosen := NEW.raw_user_meta_data ->> 'account_type';
  IF chosen = 'owner' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner') ON CONFLICT DO NOTHING;
  ELSIF chosen = 'office' THEN
    -- لا دور تلقائي هنا عمدًا: الحساب يبقى بلا دور مؤقتًا حتى يُكمل تسجيل مكتبه عبر
    -- register_office()، اللي تمنحه 'admin' فعليًا عند ذاك. حارس المسار (route.tsx) يوجّهه
    -- لشاشة التسجيل تلك بالاعتماد على account_type في بيانات حسابه، لا على أي دور.
    NULL;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'tenant') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
