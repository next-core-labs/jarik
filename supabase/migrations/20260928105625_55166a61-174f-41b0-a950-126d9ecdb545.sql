CREATE OR REPLACE FUNCTION public.renew_lease(_source_lease_id uuid, _start_date date, _annual_rent numeric, _installments integer, _term_months integer DEFAULT 12)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  v_contract_total := round(_annual_rent * _term_months / 12.0, 2);

  INSERT INTO public.leases (
    unit_id, tenant_id, start_date, end_date, annual_rent, term_months, installments, deposit,
    status, ejar_status
  ) VALUES (
    v_source.unit_id, v_source.tenant_id, _start_date, v_end_date, _annual_rent, _term_months,
    _installments, v_source.deposit, 'active', 'pending'
  )
  RETURNING id INTO v_new_lease_id;

  v_total_halala := round(v_contract_total * 100)::bigint;
  v_base_halala := round(v_total_halala::numeric / _installments)::bigint;
  IF v_total_halala - v_base_halala * (_installments - 1) < 0 THEN
    v_base_halala := floor(v_total_halala::numeric / _installments)::bigint;
  END IF;

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
$function$;

CREATE OR REPLACE FUNCTION public.my_org_ids()
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $f$ SELECT public.orgs_of_user(auth.uid()) $f$;
REVOKE ALL ON FUNCTION public.my_org_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_org_ids() TO authenticated;
DROP POLICY IF EXISTS branding_read_scoped ON storage.objects;
CREATE POLICY branding_read_scoped ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'branding' AND (storage.foldername(name))[1] IN (SELECT o::text FROM unnest(public.my_org_ids()) o));
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS account_type text;
DO $d$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='profiles_account_type_check') THEN
    ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_check
      CHECK (account_type IS NULL OR account_type IN ('office','owner','tenant'));
  END IF;
END $d$;