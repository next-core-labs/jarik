-- =============================================================================================
-- ربط ذاتي بالرمز التعريفي: مالك أو مستأجر عنده حساب في جارك أصلًا يقدر يدخل "رمز المكتب"
-- (office_code — موجود أصلًا لكل مكتب) من قسم إدارة حسابه ويرفع طلب ربط. الطلب يوصل للمكتب،
-- ومدير المكتب يوافق أو يرفض. هذا عكس اتجاه النظام الموجود (office_link_client/invitations:
-- المكتب يدعو بالإيميل والحساب يوافق) — هنا الحساب يطلب والمكتب يوافق.
--
-- نطاق متعمد أضيق مما وصفه المستخدم حرفيًا: بنيت اتجاه "مستخدم يطلب ربط مع مكتب" فقط (بالضبط
-- المثال الملموس اللي انعطى)، ولم أبنِ ربطًا مباشرًا بين مالك ومستأجر بلا عقد — هذي العلاقة أصلًا
-- تُنشأ عبر عقد إيجار حقيقي (leases)، وربط مباشر بدونه ما له معنى واضح بهيكل البيانات الحالي.
--
-- رقم التعريف: عمود جديد على profiles، يُنشأ ويُخزَّن أول مرة يُطلب (كسول، عبر
-- my_reference_code()) بدل تريغر على إنشاء الحساب — يشتغل لأي حساب موجود من قبل بلا Backfill.
-- =============================================================================================

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS reference_code text UNIQUE;

-- يرجّع رمز الحساب التعريفي، وينشئه أول مرة إذا ما كان موجودًا (6 أرقام، فريد).
CREATE OR REPLACE FUNCTION public.my_reference_code() RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); code text;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;

  -- profiles قد لا يكون له صف بعد لهذا الحساب.
  INSERT INTO public.profiles (id) VALUES (uid) ON CONFLICT (id) DO NOTHING;

  SELECT reference_code INTO code FROM public.profiles WHERE id = uid;
  IF code IS NOT NULL THEN RETURN code; END IF;

  LOOP
    code := lpad(floor(random() * 900000 + 100000)::text, 6, '0');
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE reference_code = code);
  END LOOP;
  UPDATE public.profiles SET reference_code = code WHERE id = uid;
  RETURN code;
END $$;
REVOKE ALL ON FUNCTION public.my_reference_code() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_reference_code() TO authenticated;

CREATE TABLE public.link_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('owner','tenant')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- طلب معلّق واحد بالضبط لكل (حساب، مكتب) — يمنع تكديس طلبات مكررة بلا داعٍ.
CREATE UNIQUE INDEX link_requests_pending_unique ON public.link_requests (org_id, user_id)
  WHERE status = 'pending';
DROP TRIGGER IF EXISTS set_updated_at_link_requests ON public.link_requests;
CREATE TRIGGER set_updated_at_link_requests BEFORE UPDATE ON public.link_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

GRANT SELECT ON public.link_requests TO authenticated;
GRANT ALL ON public.link_requests TO service_role;
ALTER TABLE public.link_requests ENABLE ROW LEVEL SECURITY;
-- لا سياسة INSERT/UPDATE مباشرة — كل كتابة عبر الدوال تحت فقط.
CREATE POLICY link_requests_read ON public.link_requests FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = link_requests.org_id AND m.user_id = auth.uid())
);

-- المستخدم يطلب ربطًا بمكتب عبر رمزه (office_code، حساس لحالة الأحرف مثل ما يُعرض بدليل المكاتب).
CREATE OR REPLACE FUNCTION public.request_office_link(_office_code text, _kind text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); org uuid; req_id uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF _kind NOT IN ('owner','tenant') THEN
    RAISE EXCEPTION 'النوع يجب أن يكون مالكًا أو مستأجرًا' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('office-link-request', 20, 3600) THEN
    RAISE EXCEPTION 'طلبات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;

  SELECT id INTO org FROM public.org_settings WHERE office_code = upper(trim(_office_code));
  IF org IS NULL THEN
    RAISE EXCEPTION 'ما فيه مكتب بهذا الرمز' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = org AND m.user_id = uid) THEN
    RAISE EXCEPTION 'حسابك مرتبط بهذا المكتب بالفعل' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.link_requests (org_id, user_id, kind) VALUES (org, uid, _kind)
  RETURNING id INTO req_id;
  RETURN req_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'عندك طلب معلّق لهذا المكتب أصلًا' USING ERRCODE = '23505';
END $$;
REVOKE ALL ON FUNCTION public.request_office_link(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_office_link(text, text) TO authenticated;

-- صاحب الطلب يسحبه قبل ما يُبَتّ فيه.
CREATE OR REPLACE FUNCTION public.cancel_link_request(_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE public.link_requests SET status = 'cancelled'
  WHERE id = _id AND user_id = auth.uid() AND status = 'pending'
$$;
REVOKE ALL ON FUNCTION public.cancel_link_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_link_request(uuid) TO authenticated;

-- مدير المكتب يبت في طلب وارد. عند الموافقة: نفس الحالة النهائية بالضبط اللي ينتجها
-- accept_invitation لدعوة office_link_client (org_members kind='client' + منح دور).
CREATE OR REPLACE FUNCTION public.office_decide_link_request(_id uuid, _accept boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.link_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.link_requests WHERE id = _id AND status = 'pending' FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'الطلب غير موجود أو تمت معالجته' USING ERRCODE = '02000'; END IF;
  IF NOT public.is_office_manager() OR public.my_org_id() IS DISTINCT FROM r.org_id THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;

  IF _accept THEN
    INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
    VALUES (r.org_id, r.user_id, 'client', r.kind, false)
    ON CONFLICT (org_id, user_id) DO UPDATE SET kind = 'client', role = EXCLUDED.role;
    INSERT INTO public.user_roles (user_id, role) VALUES (r.user_id, r.kind::public.app_role)
    ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.link_requests SET status = 'accepted' WHERE id = _id;
  ELSE
    UPDATE public.link_requests SET status = 'declined' WHERE id = _id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.office_decide_link_request(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_decide_link_request(uuid, boolean) TO authenticated;

-- طلبات المستخدم نفسه (لقسم إدارة الحساب).
CREATE OR REPLACE FUNCTION public.my_link_requests()
RETURNS TABLE (id uuid, org_id uuid, office_name text, kind text, status text, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT r.id, r.org_id, o.company_name, r.kind, r.status, r.created_at
  FROM public.link_requests r JOIN public.org_settings o ON o.id = r.org_id
  WHERE r.user_id = auth.uid()
  ORDER BY r.created_at DESC
  LIMIT 50
$$;
REVOKE ALL ON FUNCTION public.my_link_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_link_requests() TO authenticated;

-- الطلبات الواردة لمكتب مدير الحساب الحالي (لصفحة فريق المكتب).
CREATE OR REPLACE FUNCTION public.office_link_requests()
RETURNS TABLE (id uuid, user_id uuid, email text, full_name text, kind text, created_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := public.my_org_id();
BEGIN
  IF org IS NULL OR NOT public.is_office_manager() THEN
    RAISE EXCEPTION 'هذه الشاشة لمدير المكتب' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.user_id, u.email::text, pr.full_name, r.kind, r.created_at
  FROM public.link_requests r
  JOIN auth.users u ON u.id = r.user_id
  LEFT JOIN public.profiles pr ON pr.id = r.user_id
  WHERE r.org_id = org AND r.status = 'pending'
  ORDER BY r.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.office_link_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_link_requests() TO authenticated;