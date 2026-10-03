-- عقد إيجار شهري/متوسط المدى بجانب السنوي — annual_rent يبقى دائمًا السعر السنوي المكافئ (لتبقى
-- كل المقارنات والتقارير ولوحات المؤشرات صحيحة بلا أي تعديل عليها)، وعمود جديد term_months يحدد
-- المدة الفعلية للعقد ويقود حساب end_date والمبلغ الفعلي المُقسَّم على الدفعات.
--
-- ملاحظة اكتُشفت أثناء التنفيذ: لا يوجد بالتطبيق اليوم أي مسار لإنشاء *أول* عقد على وحدة (لا شاشة
-- "عقد جديد") — العقود تُنشأ إما عبر مزامنة إيجار (تستورد مدة العقد الفعلية من إيجار نفسها) أو
-- يدويًا بقاعدة البيانات، والمسار البرمجي الوحيد الذي يُنشئ صف عقد جديد هو renew_lease (التجديد).
-- التعديل هنا محصور به تحديدًا؛ لا حاجة لمسار "عقد أول" منفصل لأنه غير موجود أصلًا.
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS term_months integer NOT NULL DEFAULT 12;
DO $$ BEGIN
  ALTER TABLE public.leases ADD CONSTRAINT leases_term_months_check
    CHECK (term_months IN (1, 3, 6, 12));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- إضافة معامل خامس تغيّر توقيع الدالة (uuid,date,numeric,integer) إلى (uuid,date,numeric,integer,
-- integer) — CREATE OR REPLACE وحدها كانت ستنشئ نسخة ثانية موازية بدل استبدال القديمة (Postgres
-- يميّز الدوال بقائمة أنواع المعاملات كاملة)، فتبقى نسخة قديمة بلا term_months قابلة للاستدعاء بلا
-- علم أحد. الحذف الصريح هنا يضمن نسخة واحدة فقط.
DROP FUNCTION IF EXISTS public.renew_lease(uuid, date, numeric, integer);

CREATE OR REPLACE FUNCTION public.renew_lease(
  _source_lease_id uuid,
  _start_date date,
  _annual_rent numeric,
  _installments integer,
  _term_months integer DEFAULT 12
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
  v_contract_total numeric;
  v_total_halala bigint;
  v_base_halala bigint;
  v_amount numeric;
  v_index integer;
  v_span_days integer;
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
  IF _term_months IS NULL OR _term_months NOT IN (1, 3, 6, 12) THEN
    RAISE EXCEPTION 'مدة العقد يجب أن تكون 1 أو 3 أو 6 أو 12 شهرًا' USING ERRCODE = '22023';
  END IF;
  -- عقد شهر واحد بـ12 دفعة معناه دفعة كل يومين تقريبًا — غير معقول عمليًا وسيُنتج تواريخ استحقاق
  -- متلاصقة أو متطابقة بحساب "توزيع الأيام على الدفعات" أدناه.
  IF _installments > _term_months THEN
    RAISE EXCEPTION 'عدد الدفعات لا يجوز أن يتجاوز مدة العقد بالأشهر' USING ERRCODE = '22023';
  END IF;

  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source FROM public.leases WHERE id = _source_lease_id FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active' THEN
    RAISE EXCEPTION 'العقد المصدر غير موجود أو لم يعد ساريًا' USING ERRCODE = '02000';
  END IF;

  IF NOT (private.staff_scope_ok(private.org_of_unit(v_source.unit_id))
          OR private.agreement_permission(v_source.unit_id, public.my_org_id(), 'leasing')) THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على وحدة هذا العقد' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('renew_lease:' || v_source.unit_id::text));

  IF _start_date <= v_source.end_date THEN
    RAISE EXCEPTION 'يجب أن يبدأ العقد الجديد بعد انتهاء العقد الحالي' USING ERRCODE = '22023';
  END IF;

  -- عقد يمتد term_months شهرًا، وينتهي قبل ذكراه بيوم — فالتجديد التالي (يبدأ باليوم التالي لتاريخ
  -- الانتهاء) يبدأ بالضبط في يوم الذكرى، بغض النظر عن طول الشهر الميلادي.
  v_end_date := (_start_date + make_interval(months => _term_months) - INTERVAL '1 day')::date;

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

  -- annual_rent يبقى السعر السنوي المكافئ (يُحفظ كما أُدخل، لمقارنات السوق ولوحات المؤشرات) —
  -- المبلغ الفعلي المُقسَّم على الدفعات هو حصة مدة هذا العقد بالذات منه.
  v_contract_total := round(_annual_rent * _term_months / 12.0, 2);

  INSERT INTO public.leases (
    unit_id, tenant_id, start_date, end_date, annual_rent, term_months, installments, deposit,
    status, ejar_status
  ) VALUES (
    v_source.unit_id, v_source.tenant_id, _start_date, v_end_date, _annual_rent, _term_months,
    _installments, v_source.deposit, 'active', 'pending'
  )
  RETURNING id INTO v_new_lease_id;

  -- تقسيم بالهللة يطابق src/lib/installments.ts: الدفعة الأخيرة تمتص الباقي بعد التقريب، بحيث
  -- تجمع الدفعات إجمالي مدة هذا العقد بالضبط بلا فرق هللات.
  v_total_halala := round(v_contract_total * 100)::bigint;
  v_base_halala := round(v_total_halala::numeric / _installments)::bigint;
  IF v_total_halala - v_base_halala * (_installments - 1) < 0 THEN
    v_base_halala := floor(v_total_halala::numeric / _installments)::bigint;
  END IF;

  -- تباعد الدفعات على مدى العقد بالأيام: يبقى ثابت الأثر (365) للعقد السنوي المعتاد كما كان
  -- بالضبط، ويحسب المدى الفعلي بالأيام للعقود الأقصر (term_months < 12) بدل تقدير شهري تقريبي.
  v_span_days := CASE WHEN _term_months = 12 THEN 365 ELSE (v_end_date - _start_date + 1) END;

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
      _start_date + round((v_index * v_span_days)::numeric / _installments)::integer,
      'due'
    );
  END LOOP;

  UPDATE public.leases SET status = 'expired' WHERE id = v_source.id;

  BEGIN
    PERFORM public.notify_unit_staff(
      v_source.unit_id,
      'تم تجديد عقد الوحدة',
      format(
        'عقد جديد (%s شهرًا) من %s إلى %s بإيجار سنوي مكافئ %s ريال على %s دفعات.',
        _term_months,
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

REVOKE EXECUTE ON FUNCTION public.renew_lease(uuid, date, numeric, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.renew_lease(uuid, date, numeric, integer, integer) TO authenticated;
