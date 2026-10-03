-- صلاحية "announcements" جديدة بلوحة /hq: مالك الموقع (أو مدير مفوَّض بهذي الصلاحية) يكتب إعلانًا
-- نصيًا يصل كإشعار داخل الموقع (notifications، بند "الإشعارات") لكل المستأجرين والملاك دفعة واحدة
-- عبر كل المكاتب — نفس فكرة "شات" لكنه بث باتجاه واحد، لا محادثة ثنائية. سجل الإعلانات نفسه
-- (النص، وقت الإرسال، عدد من وصله) في جدول مستقل لعرضه كـ"شات" بلوحة /hq.

ALTER TABLE public.hq_admins DROP CONSTRAINT hq_admins_permissions_check;
ALTER TABLE public.hq_admins ADD CONSTRAINT hq_admins_permissions_check
  CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system', 'announcements']::text[]);

ALTER TABLE public.hq_invitations DROP CONSTRAINT hq_invitations_permissions_check;
ALTER TABLE public.hq_invitations ADD CONSTRAINT hq_invitations_permissions_check
  CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system', 'announcements']::text[]);

-- إعادة تعريف كاملة بنفس توقيع الدالة الأصلية (نص القيد المضمَّن بها فقط يتغيّر) — GRANT الحالي
-- على الدالة يبقى كما هو لأن التوقيع لم يتغيّر.
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
  IF _permissions IS NULL OR NOT (_permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system', 'announcements']::text[]) THEN
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

-- سجل الإعلانات المُرسَلة — نفس نمط platform_commissions تمامًا: قفل كامل على service_role (بلا أي
-- سياسة/منح لـauthenticated أو anon)، والوصول فقط عبر server fn محروسة بـrequireHqPermission.
CREATE TABLE public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_announcements_created_idx ON public.platform_announcements (created_at DESC);

GRANT ALL ON public.platform_announcements TO service_role;
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;
