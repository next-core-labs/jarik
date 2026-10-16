CREATE OR REPLACE FUNCTION private.my_email() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT lower(email) FROM auth.users WHERE id = auth.uid()
$$;
REVOKE ALL ON FUNCTION private.my_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.my_email() TO authenticated;

-- المرحلة 2 من لوحة "المدير العام": مالك الموقع (super_admin) يدعو أشخاصًا آخرين للوصول إلى /hq
-- بصلاحيات محددة القسم — دون منحهم دور super_admin الكامل نفسه. إدارة المدراء أنفسهم (دعوة/إزالة/
-- رؤية القائمة) تبقى حصرًا لمالك الموقع؛ مدير مفوَّض لا يقدر يدعو أو يزيل مديرًا آخر.
--
-- نفس نمط الدعوة بالبريد الموجود أصلًا (org_invitations/office_add_member/accept_invitation،
-- supabase/migrations/20260922110000_office_consent_and_isolation_fixes.sql) — بريد نصي لا user_id
-- (تخزين uuid يحوّل الدالة لأداة تكشف من مسجَّل بالمنصة)، ودورة دعوة/قبول/رفض عبر SECURITY DEFINER
-- فقط. private.my_email() مُعاد استخدامها حرفيًا، بلا تعريف جديد.
--
-- صلاحيات القسم الأربعة تطابق أقسام اللوحة الأصلية: subscribers (فعّالة اليوم — دليل المشتركين +
-- النظرة العامة المبنيان بالمرحلة 1)، وaccounting/commissions/reviews (تُخزَّن وتُعرض بالواجهة
-- بشارة "قريبًا" لحين بناء مراحلها — بلا أي إنفاذ فعلي الآن، نفس نمط UNENFORCED_PERMISSIONS
-- بـsrc/lib/agreement-permissions.ts).

CREATE TABLE public.hq_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  permissions text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked')),
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  CONSTRAINT hq_invitations_permissions_check
    CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews']::text[])
);
-- دعوة معلّقة واحدة فقط لكل بريد في نفس الوقت — دعوة ثانية لبريد له دعوة معلّقة أصلًا تُرفض بدل
-- تكديس صفوف مكررة.
CREATE UNIQUE INDEX hq_invitations_pending_email_idx ON public.hq_invitations (lower(email))
  WHERE status = 'pending';

GRANT SELECT ON public.hq_invitations TO authenticated;
GRANT ALL ON public.hq_invitations TO service_role;
ALTER TABLE public.hq_invitations ENABLE ROW LEVEL SECURITY;
-- قراءة فقط عبر RLS؛ كل كتابة عبر الدوال أدناه (SECURITY DEFINER).
CREATE POLICY hq_invitations_read ON public.hq_invitations FOR SELECT TO authenticated
USING (lower(email) = private.my_email() OR public.has_role(auth.uid(), 'super_admin'));

CREATE TABLE public.hq_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  permissions text[] NOT NULL DEFAULT '{}',
  invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hq_admins_permissions_check
    CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews']::text[])
);

GRANT SELECT ON public.hq_admins TO authenticated;
GRANT ALL ON public.hq_admins TO service_role;
ALTER TABLE public.hq_admins ENABLE ROW LEVEL SECURITY;
CREATE POLICY hq_admins_read ON public.hq_admins FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'super_admin'));

-- يدعو حسابًا (مسجَّلًا أو لا) لإدارة عامة مفوَّضة بصلاحيات قسم محددة. مالك الموقع فقط.
CREATE OR REPLACE FUNCTION public.invite_hq_admin(_email text, _permissions text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط' USING ERRCODE = '42501';
  END IF;
  IF _email IS NULL OR position('@' in _email) = 0 THEN
    RAISE EXCEPTION 'اكتب بريدًا إلكترونيًا صحيحًا' USING ERRCODE = '22023';
  END IF;
  IF _permissions IS NULL OR NOT (_permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews']::text[]) THEN
    RAISE EXCEPTION 'صلاحية غير معروفة' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('hq-invite', 20, 3600) THEN
    RAISE EXCEPTION 'دعوات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;

  INSERT INTO public.hq_invitations (email, permissions, invited_by)
  VALUES (trim(_email), _permissions, auth.uid())
  RETURNING id INTO inv_id;
  RETURN inv_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'عنده دعوة معلّقة أصلًا' USING ERRCODE = '23505';
END $$;
REVOKE ALL ON FUNCTION public.invite_hq_admin(text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.invite_hq_admin(text, text[]) TO authenticated;

-- الدعوات المعلّقة الواصلة للحساب المسجَّل دخوله.
CREATE OR REPLACE FUNCTION public.my_hq_invitations()
RETURNS TABLE(id uuid, permissions text[], created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.permissions, i.created_at
  FROM public.hq_invitations i
  WHERE i.status = 'pending' AND lower(i.email) = private.my_email()
  ORDER BY i.created_at DESC
$$;
REVOKE ALL ON FUNCTION public.my_hq_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_hq_invitations() TO authenticated;

-- قبول الدعوة: هذا فقط ما يمنح صف hq_admins.
CREATE OR REPLACE FUNCTION public.accept_hq_invitation(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv record; uid uuid := auth.uid();
BEGIN
  SELECT * INTO inv FROM public.hq_invitations
   WHERE id = _id AND status = 'pending' AND lower(email) = private.my_email();
  IF inv IS NULL THEN
    RAISE EXCEPTION 'الدعوة غير موجودة أو انتهت' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.hq_admins (user_id, permissions, invited_by)
  VALUES (uid, inv.permissions, inv.invited_by)
  ON CONFLICT (user_id) DO UPDATE SET permissions = EXCLUDED.permissions;

  UPDATE public.hq_invitations SET status = 'accepted', answered_at = now() WHERE id = _id;
END $$;
REVOKE ALL ON FUNCTION public.accept_hq_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_hq_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_hq_invitation(_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.hq_invitations SET status = 'declined', answered_at = now()
  WHERE id = _id AND status = 'pending' AND lower(email) = private.my_email()
$$;
REVOKE ALL ON FUNCTION public.decline_hq_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_hq_invitation(uuid) TO authenticated;

-- الدعوات المعلّقة لمالك الموقع (قائمة "المدراء" بلوحة /hq).
CREATE OR REPLACE FUNCTION public.hq_admin_invitations()
RETURNS TABLE(id uuid, email text, permissions text[], created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.id, i.email, i.permissions, i.created_at
  FROM public.hq_invitations i WHERE i.status = 'pending'
  ORDER BY i.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.hq_admin_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_admin_invitations() TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_hq_invitation(_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط' USING ERRCODE = '42501';
  END IF;
  UPDATE public.hq_invitations SET status = 'revoked', answered_at = now()
  WHERE id = _id AND status = 'pending';
END $$;
REVOKE ALL ON FUNCTION public.revoke_hq_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_hq_invitation(uuid) TO authenticated;

-- كل المدراء المفوَّضين الحاليين، بأسمائهم وبريدهم.
CREATE OR REPLACE FUNCTION public.list_hq_admins()
RETURNS TABLE(user_id uuid, email text, full_name text, permissions text[], created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT a.user_id, u.email::text, p.full_name, a.permissions, a.created_at
  FROM public.hq_admins a
  JOIN auth.users u ON u.id = a.user_id
  LEFT JOIN public.profiles p ON p.id = a.user_id
  ORDER BY a.created_at;
END $$;
REVOKE ALL ON FUNCTION public.list_hq_admins() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_hq_admins() TO authenticated;

CREATE OR REPLACE FUNCTION public.remove_hq_admin(_user_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.hq_admins WHERE user_id = _user_id;
END $$;
REVOKE ALL ON FUNCTION public.remove_hq_admin(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_hq_admin(uuid) TO authenticated;
