-- =============================================================================================
-- من roadmap.md «متبقٍ — يحتاج قرارك أو عملًا أكبر»: التجديد كان عملية ذرّية واحدة *مقصودة* لكن
-- منفَّذة كثلاث كتابات منفصلة من المتصفح (src/routes/_authenticated/renewals.tsx): إدراج العقد
-- الجديد، إدراج دفعاته، ثم تحديث العقد القديم لـ'expired' — مع تراجع يدوي (rollback) لو كتابة
-- لاحقة فشلت، لكن بلا حماية من انقطاع فعلي (تبويب يُغلق، الشبكة تنقطع) بين الخطوات: نافذة حقيقية
-- يصير فيها عقدان ساريان لنفس الوحدة بلا أي تراجع تلقائي. هذي Migration تبني الشي نفسه بالضبط
-- (نفس منطق تقسيم الدفعات بالهللة من src/lib/installments.ts، نفس حساب end_date، نفس فحص التكرار)
-- كدالة SQL واحدة SECURITY DEFINER — تلتزم أو تتراجع كوحدة عبر معاملة قاعدة البيانات نفسها، لا
-- منطق تراجع يدوي بجافاسكربت.
--
-- الصلاحية: تطابق تمامًا سياسات leases الحالية (20260924170000) — موظف مكتب الوحدة الأصلي، أو
-- مكتب اتفاقية إدارة سارية بصلاحية 'leasing' على هذي الوحدة تحديدًا. الإشعار (notify_unit_staff)
-- يبقى معزولًا (best-effort، بلا تأثير على نجاح التجديد نفسه) لأن notify_unit_staff نفسها تتحقق
-- من staff_scope_ok فقط بلا مسار اتفاقية — فشلها لمكتب اتفاقية لا يجوز يُسقِط التجديد الناجح فعليًا،
-- تمامًا متل السلوك الحالي (كانت استدعاء RPC منفصل من المتصفح بعد نجاح الكتابات الثلاث).
-- =============================================================================================

CREATE OR REPLACE FUNCTION public.renew_lease(
  _source_lease_id uuid,
  _start_date date,
  _annual_rent numeric,
  _installments integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.leases%ROWTYPE;
  v_new_lease_id uuid;
  v_end_date date;
  v_total_halala bigint;
  v_base_halala bigint;
  v_amount numeric;
  v_index integer;
BEGIN
  IF _start_date IS NULL THEN
    RAISE EXCEPTION 'أدخل تاريخ بدء العقد الجديد' USING ERRCODE = '22023';
  END IF;
  IF _annual_rent IS NULL OR _annual_rent <= 0 OR _annual_rent <> round(_annual_rent, 2) THEN
    RAISE EXCEPTION 'أدخل إيجارًا سنويًا موجبًا بحد أقصى منزلتين عشريتين' USING ERRCODE = '22023';
  END IF;
  IF _installments IS NULL OR _installments < 1 OR _installments > 24 THEN
    RAISE EXCEPTION 'عدد الدفعات يجب أن يكون بين 1 و24' USING ERRCODE = '22023';
  END IF;

  -- إصلاح أثناء المراجعة الذاتية: private.staff_scope_ok() ترجع TRUE تلقائيًا لأي متصل *غير*
  -- موظف (مصمَّمة لتُستخدم مع سياسة RLS تحصر مسارها بمن يجتاز فحص is_staff() أصلًا بمكان آخر —
  -- هنا لا يوجد ذاك الفحص المنفصل، فبدون IF صريح كان أي حساب مالك أو مستأجر يمرّ من هذا الشرط
  -- كأنه ضمن نطاق مكتبه تلقائيًا، ويجدّد أي عقد على أي وحدة).
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source FROM public.leases WHERE id = _source_lease_id FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active' THEN
    RAISE EXCEPTION 'العقد المصدر غير موجود أو لم يعد ساريًا' USING ERRCODE = '02000';
  END IF;

  -- موظف مكتب الوحدة الأصلي، أو مكتب اتفاقية إدارة سارية بصلاحية 'leasing' على هذي الوحدة —
  -- يطابق بالضبط org_isolation_insert/_update على leases (20260924170000).
  IF NOT (private.staff_scope_ok(private.org_of_unit(v_source.unit_id))
          OR private.agreement_permission(v_source.unit_id, public.my_org_id(), 'leasing')) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على وحدة هذا العقد' USING ERRCODE = '42501';
  END IF;

  -- SELECT ... FOR UPDATE أعلاه يحجز الصف طول المعاملة (حتى أثناء انتظار هذا القفل)، فتجديد
  -- متزامن آخر لنفس العقد المصدر يستحيل يمرّ من هنا أصلًا — لا حاجة لإعادة فحص حالته بعد القفل.
  -- القفل هنا يحمي حالة مختلفة: تجديدان متزامنان لعقدين ساريين مختلفين على نفس الوحدة (مثلًا
  -- نقرة مزدوجة على تجديدين متتاليين بالخطأ)، يجعلهما يتسلسلان بدل يتسابقان على فحص التداخل تحت.
  -- بادئة النطاق بالمفتاح (renew_lease:) تفادي تصادم عرضي مع مفتاح آخر بنفس مساحة hashtext
  -- (market_requests:phone بملف 20260924130000).
  PERFORM pg_advisory_xact_lock(hashtext('renew_lease:' || v_source.unit_id::text));

  IF _start_date <= v_source.end_date THEN
    RAISE EXCEPTION 'يجب أن يبدأ العقد الجديد بعد انتهاء العقد الحالي' USING ERRCODE = '22023';
  END IF;

  -- عقد يمتد سنة، وينتهي قبل ذكراه بيوم — فالتجديد التالي (يبدأ باليوم التالي لتاريخ الانتهاء)
  -- يبدأ بالضبط في يوم الذكرى.
  v_end_date := (_start_date + INTERVAL '1 year' - INTERVAL '1 day')::date;

  IF EXISTS (
    SELECT 1 FROM public.leases l
    WHERE l.unit_id = v_source.unit_id
      AND l.id <> v_source.id
      AND l.status = 'active'
      AND l.start_date <= v_end_date
      AND l.end_date >= _start_date
  ) THEN
    RAISE EXCEPTION 'يوجد عقد ساري متداخل لهذه الوحدة' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.leases (
    unit_id, tenant_id, start_date, end_date, annual_rent, installments, deposit, status, ejar_status
  ) VALUES (
    v_source.unit_id, v_source.tenant_id, _start_date, v_end_date, _annual_rent,
    _installments, v_source.deposit, 'active', 'pending'
  )
  RETURNING id INTO v_new_lease_id;

  -- تقسيم بالهللة يطابق src/lib/installments.ts تمامًا: الدفعة الأخيرة تمتص الباقي بعد التقريب،
  -- بحيث تجمع الدفعات الإيجار السنوي بالضبط بلا فرق هللات.
  v_total_halala := round(_annual_rent * 100)::bigint;
  v_base_halala := round(v_total_halala::numeric / _installments)::bigint;
  IF v_total_halala - v_base_halala * (_installments - 1) < 0 THEN
    v_base_halala := floor(v_total_halala::numeric / _installments)::bigint;
  END IF;

  FOR v_index IN 0..(_installments - 1) LOOP
    v_amount := CASE
      WHEN v_index = _installments - 1
        THEN (v_total_halala - v_base_halala * (_installments - 1)) / 100.0
      ELSE v_base_halala / 100.0
    END;
    INSERT INTO public.payments (lease_id, amount, due_date, status)
    VALUES (
      v_new_lease_id,
      v_amount,
      _start_date + round((v_index * 365)::numeric / _installments)::integer,
      'due'
    );
  END LOOP;

  UPDATE public.leases SET status = 'expired' WHERE id = v_source.id;

  -- إشعار "بأفضل جهد" — نفس دلالة الاستدعاء المنفصل الحالي من المتصفح بعد نجاح الكتابات الثلاث:
  -- فشله لا يُسقِط تجديدًا نجح فعلًا. مهم خصوصًا لمكتب اتفاقية: notify_unit_staff() نفسها تتحقق
  -- فقط من staff_scope_ok (لا مسار اتفاقية)، فتفشل له دائمًا رغم صلاحيته الفعلية على العقد.
  BEGIN
    PERFORM public.notify_unit_staff(
      v_source.unit_id,
      'تم تجديد عقد الوحدة',
      format(
        'عقد جديد من %s إلى %s بإيجار سنوي %s ريال على %s دفعات.',
        _start_date,
        v_end_date,
        to_char(_annual_rent, 'FM999G999G999G990D00'),
        _installments
      ),
      'lease'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN v_new_lease_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.renew_lease(uuid, date, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_lease(uuid, date, numeric, integer) TO authenticated;
