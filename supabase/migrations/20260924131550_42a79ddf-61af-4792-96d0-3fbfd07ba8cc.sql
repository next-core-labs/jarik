-- =============================================================================================
-- بوابة المالك، المرحلة الثانية: اتفاقية الإدارة بين المالك والمكتب (owner-dashboard-prompt.md،
-- قسم 2). هذه Migration إضافية بالكامل — تنشئ جداول ودوال جديدة فقط، ولا تلمس أي سياسة RLS
-- موجودة على properties/units/leases/maintenance_requests. ربط الفحص المركزي
-- (private.agreement_permission) بتلك السياسات مقصود يكون Migration منفصلة تُراجع لحالها، لأن
-- إعادة ربط RLS موجودة هي بالضبط نوع التغيير اللي سبّب تسريب بيانات حقيقي بين المكاتب قبل كذا
-- (20260924110000_close_cross_office_data_leak.sql).
--
-- التبسيط المتعمد مقارنةً بالمواصفة الحرفية: ما فيه حالة "مسودة" منفصلة قبل الإرسال — طلب المالك
-- يُنشأ ويُرسل بخطوة وحدة (status='sent' مباشرة). لا شي يمنع إضافة "حفظ كمسودة" لاحقًا.
--
-- النموذج: اتفاقية واحدة (management_agreements) تغطي مجموعة وحدات (agreement_units) بمجموعة
-- صلاحيات (agreement_permissions). "عقار كامل" في واجهة المالك تُترجم لكل وحدات ذاك العقار وقت
-- إنشاء الطلب. فترة الإشعار عند الإنهاء تُحسب حيّة (termination_requested_at + notice_period_days)
-- بدل الاعتماد على مهمة مجدولة — الوصول ينقطع فعليًا بمجرد ما الوقت يمر، بصرف النظر عن أي حالة
-- معروضة بالواجهة.
-- =============================================================================================

-- نسبة العمولة المعلنة للمكتب (تُعرض بكرت المكتب بدليل المكاتب) — لا علاقة لها بعمولة المنصة
-- (اللي هي موضوع منفصل تمامًا، admin-dashboard-prompt.md).
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS default_commission_pct numeric;

CREATE TABLE public.management_agreements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent'
    CHECK (status IN ('sent','office_modified','active','rejected','cancelled')),
  initiated_by text NOT NULL DEFAULT 'owner' CHECK (initiated_by IN ('owner','office')),
  commission_type text NOT NULL DEFAULT 'percent' CHECK (commission_type IN ('percent','fixed')),
  commission_value numeric NOT NULL CHECK (commission_value >= 0),
  start_date date NOT NULL,
  end_date date,
  notice_period_days integer NOT NULL DEFAULT 30 CHECK (notice_period_days >= 0),
  maintenance_cap numeric CHECK (maintenance_cap IS NULL OR maintenance_cap >= 0),
  termination_requested_by text CHECK (termination_requested_by IN ('owner','office')),
  termination_requested_at timestamptz,
  -- نسخة مجمّدة من الشروط وقت الموافقة النهائية — ما تتعدّل بعدها (يُكتب لها مرة وحدة فقط).
  accepted_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date > start_date)
);
CREATE INDEX management_agreements_org_idx ON public.management_agreements (org_id);
CREATE INDEX management_agreements_owner_idx ON public.management_agreements (owner_id);
DROP TRIGGER IF EXISTS set_updated_at_agreements ON public.management_agreements;
CREATE TRIGGER set_updated_at_agreements BEFORE UPDATE ON public.management_agreements
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS audit_agreements ON public.management_agreements;
CREATE TRIGGER audit_agreements AFTER INSERT OR UPDATE OR DELETE ON public.management_agreements
FOR EACH ROW EXECUTE FUNCTION public.audit_row();

GRANT SELECT ON public.management_agreements TO authenticated;
GRANT ALL ON public.management_agreements TO service_role;
ALTER TABLE public.management_agreements ENABLE ROW LEVEL SECURITY;
-- لا سياسة INSERT/UPDATE هنا عمدًا — كل كتابة تمر عبر دوال SECURITY DEFINER تحت، اللي تتحقق من
-- انتقال الحالة بنفسها بدل ما تُشفَّر بشروط RLS معقّدة. القراءة فقط مباحة مباشرة.
CREATE POLICY management_agreements_read ON public.management_agreements FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = management_agreements.org_id AND m.user_id = auth.uid())
);

CREATE TABLE public.agreement_units (
  agreement_id uuid NOT NULL REFERENCES public.management_agreements(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  PRIMARY KEY (agreement_id, unit_id)
);
CREATE INDEX agreement_units_unit_idx ON public.agreement_units (unit_id);
GRANT SELECT ON public.agreement_units TO authenticated;
GRANT ALL ON public.agreement_units TO service_role;
ALTER TABLE public.agreement_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY agreement_units_read ON public.agreement_units FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_units.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()))
  )
);

CREATE TABLE public.agreement_permissions (
  agreement_id uuid NOT NULL REFERENCES public.management_agreements(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN
    ('leasing','pricing','ejar','collection','maintenance','tenant_comms','renewal_eviction','sale')),
  PRIMARY KEY (agreement_id, permission)
);
GRANT SELECT ON public.agreement_permissions TO authenticated;
GRANT ALL ON public.agreement_permissions TO service_role;
ALTER TABLE public.agreement_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY agreement_permissions_read ON public.agreement_permissions FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_permissions.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()))
  )
);

-- طلبات موافقة عامة لأي عملية تتجاوز صلاحية سارية حاليًا (مثال: توسيع الصلاحيات من المالك يحتاج
-- موافقة المكتب). سقف الصيانة له مساره الخاص أصلًا (maintenance_requests.approval_status الموجود)
-- ولا يمر من هنا.
CREATE TABLE public.agreement_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agreement_id uuid NOT NULL REFERENCES public.management_agreements(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('permission_widen')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agreement_change_requests TO authenticated;
GRANT ALL ON public.agreement_change_requests TO service_role;
ALTER TABLE public.agreement_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY agreement_change_requests_read ON public.agreement_change_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_change_requests.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()))
  )
);

-- =============================================================================================
-- الفحص المركزي. STABLE SECURITY DEFINER — يُستدعى من الكود (server functions) اليوم، ومن سياسات
-- RLS لاحقًا (Migration منفصلة). يحسب "سارية" حيًا حسب فترة الإشعار، لا حسب عمود status وحده.
-- =============================================================================================
CREATE OR REPLACE FUNCTION private.agreement_active(_unit_id uuid, _org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.management_agreements a
    JOIN public.agreement_units au ON au.agreement_id = a.id
    WHERE au.unit_id = _unit_id
      AND a.org_id = _org_id
      AND a.status = 'active'
      AND (a.termination_requested_at IS NULL
           OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  )
$$;
REVOKE ALL ON FUNCTION private.agreement_active(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.agreement_active(uuid, uuid) TO authenticated, service_role;

-- "view" ضمنية دائمًا لأي اتفاقية سارية (لا تحتاج صف في agreement_permissions) — أي صلاحية أخرى
-- تحتاج صفًا فعليًا.
CREATE OR REPLACE FUNCTION private.agreement_permission(_unit_id uuid, _org_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _perm = 'view' THEN private.agreement_active(_unit_id, _org_id)
    ELSE EXISTS (
      SELECT 1
      FROM public.management_agreements a
      JOIN public.agreement_units au ON au.agreement_id = a.id
      JOIN public.agreement_permissions ap ON ap.agreement_id = a.id
      WHERE au.unit_id = _unit_id
        AND a.org_id = _org_id
        AND a.status = 'active'
        AND ap.permission = _perm
        AND (a.termination_requested_at IS NULL
             OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
    )
  END
$$;
REVOKE ALL ON FUNCTION private.agreement_permission(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.agreement_permission(uuid, uuid, text) TO authenticated, service_role;

-- سقف الصيانة الفعّال لوحدة معيّنة: سقف الاتفاقية السارية إن وُجد، وإلا سقف المكتب الافتراضي
-- (owner_approval_threshold الموجود). يُستخدم من الواجهة بدل قراءة owner_approval_threshold وحده.
CREATE OR REPLACE FUNCTION public.effective_maintenance_cap(_unit_id uuid, _org_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT a.maintenance_cap
     FROM public.management_agreements a
     JOIN public.agreement_units au ON au.agreement_id = a.id
     WHERE au.unit_id = _unit_id AND a.org_id = _org_id AND a.status = 'active'
       AND (a.termination_requested_at IS NULL
            OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
       AND a.maintenance_cap IS NOT NULL
     LIMIT 1),
    (SELECT o.owner_approval_threshold FROM public.org_settings o WHERE o.id = _org_id)
  )
$$;
REVOKE ALL ON FUNCTION public.effective_maintenance_cap(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_maintenance_cap(uuid, uuid) TO authenticated, service_role;

-- =============================================================================================
-- دورة حياة الاتفاقية — كل الكتابة تمر من هنا (لا سياسة INSERT/UPDATE مباشرة على الجدول).
-- =============================================================================================

-- المالك يرسل طلب إدارة لمكتب على وحدة أو أكثر (عقار كامل = كل وحداته وقت الطلب من الواجهة).
CREATE OR REPLACE FUNCTION public.request_management_agreement(
  _org_id uuid, _unit_ids uuid[], _commission_type text, _commission_value numeric,
  _start_date date, _end_date date, _notice_period_days integer, _maintenance_cap numeric,
  _permissions text[]
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE agreement_id uuid; uid uuid := auth.uid(); uid_check uuid;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF _unit_ids IS NULL OR array_length(_unit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'اختر وحدة واحدة على الأقل' USING ERRCODE = '22023';
  END IF;

  -- كل وحدة لازم تكون فعلاً مملوكة لمن يطلب — عبر عقارها.
  SELECT u.id INTO uid_check
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = ANY(_unit_ids) AND p.owner_id IS DISTINCT FROM uid
  LIMIT 1;
  IF uid_check IS NOT NULL THEN
    RAISE EXCEPTION 'إحدى الوحدات ليست مملوكة لك' USING ERRCODE = '42501';
  END IF;

  -- ولا وحدة منها لها اتفاقية سارية حاليًا (مع أي مكتب) — الطلبات المعلّقة لمكاتب أخرى مسموحة.
  IF EXISTS (
    SELECT 1 FROM public.agreement_units au
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE au.unit_id = ANY(_unit_ids) AND a.status = 'active'
      AND (a.termination_requested_at IS NULL
           OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  ) THEN
    RAISE EXCEPTION 'إحدى الوحدات لها اتفاقية سارية بالفعل' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.management_agreements
    (org_id, owner_id, status, initiated_by, commission_type, commission_value,
     start_date, end_date, notice_period_days, maintenance_cap)
  VALUES
    (_org_id, uid, 'sent', 'owner', _commission_type, _commission_value,
     _start_date, _end_date, COALESCE(_notice_period_days, 30), _maintenance_cap)
  RETURNING id INTO agreement_id;

  INSERT INTO public.agreement_units (agreement_id, unit_id)
  SELECT agreement_id, u FROM unnest(_unit_ids) AS u;

  IF _permissions IS NOT NULL THEN
    INSERT INTO public.agreement_permissions (agreement_id, permission)
    SELECT agreement_id, p FROM unnest(_permissions) AS p;
  END IF;

  RETURN agreement_id;
END $$;
REVOKE ALL ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[]) TO authenticated;

-- المكتب يرد على طلب: قبول مباشر، رفض، أو تعديل مضاد (يرجع للمالك للبت).
CREATE OR REPLACE FUNCTION public.office_respond_agreement(
  _agreement_id uuid, _decision text,
  _commission_value numeric DEFAULT NULL, _notice_period_days integer DEFAULT NULL,
  _maintenance_cap numeric DEFAULT NULL, _permissions text[] DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; conflict_unit uuid;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الاتفاقية غير موجودة' USING ERRCODE = '02000'; END IF;
  IF NOT public.is_staff(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'هذا الطلب ليس لمكتبك' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('sent') THEN
    RAISE EXCEPTION 'الطلب ليس بانتظار ردّ المكتب' USING ERRCODE = '22023';
  END IF;

  IF _decision = 'reject' THEN
    UPDATE public.management_agreements SET status = 'rejected' WHERE id = _agreement_id;
    RETURN;
  END IF;

  IF _decision = 'counter' THEN
    UPDATE public.management_agreements SET
      status = 'office_modified',
      commission_value = COALESCE(_commission_value, commission_value),
      notice_period_days = COALESCE(_notice_period_days, notice_period_days),
      maintenance_cap = COALESCE(_maintenance_cap, maintenance_cap)
    WHERE id = _agreement_id;
    IF _permissions IS NOT NULL THEN
      DELETE FROM public.agreement_permissions WHERE agreement_id = _agreement_id;
      INSERT INTO public.agreement_permissions (agreement_id, permission)
      SELECT _agreement_id, p FROM unnest(_permissions) AS p;
    END IF;
    RETURN;
  END IF;

  IF _decision = 'accept' THEN
    SELECT au.unit_id INTO conflict_unit
    FROM public.agreement_units au
    JOIN public.management_agreements a2 ON a2.id = au.agreement_id
    WHERE au.agreement_id <> _agreement_id
      AND au.unit_id IN (SELECT unit_id FROM public.agreement_units WHERE agreement_id = _agreement_id)
      AND a2.status = 'active'
      AND (a2.termination_requested_at IS NULL
           OR now() < a2.termination_requested_at + make_interval(days => a2.notice_period_days))
    LIMIT 1;
    IF conflict_unit IS NOT NULL THEN
      RAISE EXCEPTION 'إحدى الوحدات صار لها اتفاقية سارية مع مكتب آخر بين طلب الاتفاقية والقبول'
        USING ERRCODE = '23505';
    END IF;
    UPDATE public.management_agreements SET
      status = 'active',
      accepted_snapshot = to_jsonb(a) || jsonb_build_object('accepted_at', now())
    WHERE id = _agreement_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'قرار غير معروف' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[]) TO authenticated;

-- المالك يبت في تعديل المكتب المضاد.
CREATE OR REPLACE FUNCTION public.owner_decide_countered_agreement(_agreement_id uuid, _decision text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; conflict_unit uuid;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL OR a.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'الاتفاقية غير موجودة أو ليست لك' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'office_modified' THEN
    RAISE EXCEPTION 'ما فيه تعديل من المكتب بانتظار قرارك' USING ERRCODE = '22023';
  END IF;

  IF _decision = 'reject' THEN
    UPDATE public.management_agreements SET status = 'rejected' WHERE id = _agreement_id;
    RETURN;
  END IF;

  IF _decision = 'accept' THEN
    SELECT au.unit_id INTO conflict_unit
    FROM public.agreement_units au
    JOIN public.management_agreements a2 ON a2.id = au.agreement_id
    WHERE au.agreement_id <> _agreement_id
      AND au.unit_id IN (SELECT unit_id FROM public.agreement_units WHERE agreement_id = _agreement_id)
      AND a2.status = 'active'
      AND (a2.termination_requested_at IS NULL
           OR now() < a2.termination_requested_at + make_interval(days => a2.notice_period_days))
    LIMIT 1;
    IF conflict_unit IS NOT NULL THEN
      RAISE EXCEPTION 'إحدى الوحدات صار لها اتفاقية سارية مع مكتب آخر' USING ERRCODE = '23505';
    END IF;
    UPDATE public.management_agreements SET
      status = 'active',
      accepted_snapshot = to_jsonb(a) || jsonb_build_object('accepted_at', now())
    WHERE id = _agreement_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'قرار غير معروف' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.owner_decide_countered_agreement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_decide_countered_agreement(uuid, text) TO authenticated;

-- المالك يعدّل الصلاحيات أثناء السريان: تقليص فوري، توسيع يحتاج موافقة المكتب.
CREATE OR REPLACE FUNCTION public.update_agreement_permissions(_agreement_id uuid, _permissions text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; current_perms text[]; added text[]; removed text[];
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id;
  IF a.id IS NULL OR a.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'الاتفاقية غير موجودة أو ليست لك' USING ERRCODE = '42501';
  END IF;
  IF a.status <> 'active' THEN
    RAISE EXCEPTION 'الاتفاقية ليست سارية' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(array_agg(permission), '{}') INTO current_perms
  FROM public.agreement_permissions WHERE agreement_id = _agreement_id;

  SELECT COALESCE(array_agg(p), '{}') INTO removed
  FROM unnest(current_perms) AS p WHERE NOT (p = ANY(_permissions));
  SELECT COALESCE(array_agg(p), '{}') INTO added
  FROM unnest(_permissions) AS p WHERE NOT (p = ANY(current_perms));

  IF array_length(removed, 1) IS NOT NULL THEN
    DELETE FROM public.agreement_permissions
    WHERE agreement_id = _agreement_id AND permission = ANY(removed);
  END IF;

  IF array_length(added, 1) IS NOT NULL THEN
    INSERT INTO public.agreement_change_requests (agreement_id, kind, payload, requested_by)
    SELECT _agreement_id, 'permission_widen', jsonb_build_object('permission', p), auth.uid()
    FROM unnest(added) AS p;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_agreement_permissions(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_agreement_permissions(uuid, text[]) TO authenticated;

-- المكتب يبت في طلب توسيع صلاحية.
CREATE OR REPLACE FUNCTION public.office_decide_change_request(_request_id uuid, _decision text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.agreement_change_requests%ROWTYPE; a public.management_agreements%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.agreement_change_requests WHERE id = _request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'الطلب غير موجود' USING ERRCODE = '02000'; END IF;
  SELECT * INTO a FROM public.management_agreements WHERE id = r.agreement_id;
  IF NOT public.is_staff(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'هذا الطلب ليس لمكتبك' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'تمت معالجة هذا الطلب مسبقًا' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agreement_change_requests
  SET status = CASE WHEN _decision = 'approve' THEN 'approved' ELSE 'rejected' END, decided_at = now()
  WHERE id = _request_id;

  IF _decision = 'approve' AND r.kind = 'permission_widen' THEN
    INSERT INTO public.agreement_permissions (agreement_id, permission)
    VALUES (r.agreement_id, r.payload ->> 'permission')
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.office_decide_change_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_decide_change_request(uuid, text) TO authenticated;

-- أي طرف يطلب الإنهاء — الوصول ينقطع تلقائيًا (حسابيًا، عبر private.agreement_active) بعد فترة
-- الإشعار، بلا حاجة لمهمة مجدولة.
CREATE OR REPLACE FUNCTION public.request_agreement_termination(_agreement_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; requested_by_party text;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الاتفاقية غير موجودة' USING ERRCODE = '02000'; END IF;
  IF a.status <> 'active' THEN
    RAISE EXCEPTION 'الاتفاقية ليست سارية' USING ERRCODE = '22023';
  END IF;

  IF a.owner_id = auth.uid() THEN
    requested_by_party := 'owner';
  ELSIF public.is_staff(auth.uid())
        AND EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = a.org_id AND m.user_id = auth.uid()) THEN
    requested_by_party := 'office';
  ELSE
    RAISE EXCEPTION 'ما تقدر تنهي هذي الاتفاقية' USING ERRCODE = '42501';
  END IF;

  UPDATE public.management_agreements
  SET termination_requested_by = requested_by_party, termination_requested_at = now()
  WHERE id = _agreement_id AND termination_requested_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.request_agreement_termination(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_agreement_termination(uuid) TO authenticated;

-- المالك يقدر يشوف سجل التدقيق لعملياته الخاصة (عقاراته ووحداته وعقوده وطلبات صيانته) — كان
-- مقصورًا على الموظفين فقط. إضافية بحتة، ما تغيّر قراءة الموظف الموجودة.
CREATE POLICY audit_log_owner_read ON public.audit_log FOR SELECT TO authenticated USING (
  CASE table_name
    WHEN 'properties' THEN EXISTS (
      SELECT 1 FROM public.properties p WHERE p.id = row_id AND p.owner_id = auth.uid())
    WHEN 'units' THEN EXISTS (
      SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
      WHERE u.id = row_id AND p.owner_id = auth.uid())
    WHEN 'leases' THEN EXISTS (
      SELECT 1 FROM public.leases l JOIN public.units u ON u.id = l.unit_id
      JOIN public.properties p ON p.id = u.property_id
      WHERE l.id = row_id AND p.owner_id = auth.uid())
    WHEN 'maintenance_requests' THEN EXISTS (
      SELECT 1 FROM public.maintenance_requests mr JOIN public.units u ON u.id = mr.unit_id
      JOIN public.properties p ON p.id = u.property_id
      WHERE mr.id = row_id AND p.owner_id = auth.uid())
    ELSE false
  END
);