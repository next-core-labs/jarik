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