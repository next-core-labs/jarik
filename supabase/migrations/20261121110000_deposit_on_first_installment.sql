-- The security deposit is collected with the first installment.
--
-- Until now a lease's deposit was only a figure on the lease: the schedule never asked the tenant
-- for it. create_lease and correct_lease now add it to the first installment (one, four or twelve
-- installments alike), and payments.deposit_amount records how much of that installment is the
-- deposit, so rent and deposit can still be told apart. A renewal carries the old deposit over
-- (renew_lease, unchanged), so it charges nothing new. Existing schedules are left as they are.

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS deposit_amount numeric NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE public.payments ADD CONSTRAINT payments_deposit_amount_nonneg
    CHECK (deposit_amount >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
COMMENT ON COLUMN public.payments.deposit_amount IS
  'The part of amount that is the lease''s security deposit (first installment only), not rent.';

CREATE OR REPLACE FUNCTION public.create_lease(
  _unit_id uuid, _tenant_id uuid, _new_tenant jsonb, _start_date date, _term_months integer,
  _annual_rent numeric, _installments integer, _deposit numeric DEFAULT 0
) RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE
  v_unit record;
  v_org uuid;
  v_tenant uuid := _tenant_id;
  v_lease uuid;
  v_name text := btrim(COALESCE(_new_tenant ->> 'full_name', ''));
  v_code text := btrim(COALESCE(_new_tenant ->> 'reference_code', ''));
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  PERFORM private.check_lease_terms(_start_date, _term_months, _annual_rent, _installments);
  IF _deposit IS NULL OR _deposit < 0 OR _deposit <> round(_deposit, 2) THEN
    RAISE EXCEPTION 'أدخل مبلغ التأمين بالأرقام (0 إن لم يوجد)' USING ERRCODE = '22023';
  END IF;

  SELECT u.id, u.status, u.listing_purpose INTO v_unit FROM public.units u WHERE u.id = _unit_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد الوحدة' USING ERRCODE = '02000';
  END IF;
  IF v_unit.status = 'sold' THEN
    RAISE EXCEPTION 'الوحدة مباعة ولا تقبل عقد إيجار' USING ERRCODE = '22023';
  END IF;
  IF NOT private.staff_can_on_unit(_unit_id, 'leasing') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية تأجير هذه الوحدة' USING ERRCODE = '42501';
  END IF;
  v_org := private.org_of_unit(_unit_id);

  IF v_tenant IS NULL AND v_code <> '' THEN
    v_tenant := private.tenant_for_account_code(v_code, v_org);
    -- Unknown code: no lease, but the attempt stays counted (a RAISE would roll the counter back).
    IF v_tenant IS NULL THEN RETURN NULL; END IF;
  ELSIF v_tenant IS NULL THEN
    IF char_length(v_name) < 3 THEN
      RAISE EXCEPTION 'اكتب اسم المستأجر الكامل' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.tenants (full_name, phone, national_id, email, org_id)
    VALUES (
      v_name,
      NULLIF(btrim(COALESCE(_new_tenant ->> 'phone', '')), ''),
      NULLIF(btrim(COALESCE(_new_tenant ->> 'national_id', '')), ''),
      NULLIF(btrim(COALESCE(_new_tenant ->> 'email', '')), ''),
      v_org
    )
    RETURNING id INTO v_tenant;
  ELSIF NOT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = v_tenant) THEN
    RAISE EXCEPTION 'لم نجد المستأجر' USING ERRCODE = '02000';
  END IF;

  INSERT INTO public.leases (
    unit_id, tenant_id, start_date, end_date, annual_rent, term_months, installments, deposit,
    status, ejar_status
  ) VALUES (
    _unit_id, v_tenant, _start_date,
    (_start_date + make_interval(months => _term_months) - INTERVAL '1 day')::date,
    _annual_rent, _term_months, _installments, _deposit, 'active', 'pending'
  )
  RETURNING id INTO v_lease;

  -- The deposit rides on the first installment, whatever the number of installments.
  INSERT INTO public.payments (lease_id, amount, deposit_amount, due_date, status)
  SELECT v_lease, s.amount + CASE WHEN s.seq = 1 THEN _deposit ELSE 0 END,
         CASE WHEN s.seq = 1 THEN _deposit ELSE 0 END, s.due_date, 'due'
  FROM private.lease_schedule(_start_date, _term_months, _annual_rent, _installments) s;

  RETURN v_lease;
END $$;
REVOKE ALL ON FUNCTION public.create_lease(uuid, uuid, jsonb, date, integer, numeric, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lease(uuid, uuid, jsonb, date, integer, numeric, integer, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.correct_lease(
  _lease_id uuid, _start_date date, _term_months integer, _annual_rent numeric,
  _installments integer, _deposit numeric
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lease public.leases%ROWTYPE;
BEGIN
  PERFORM private.check_lease_terms(_start_date, _term_months, _annual_rent, _installments);
  IF _deposit IS NULL OR _deposit < 0 OR _deposit <> round(_deposit, 2) THEN
    RAISE EXCEPTION 'أدخل مبلغ التأمين بالأرقام (0 إن لم يوجد)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_lease FROM public.leases WHERE id = _lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد العقد' USING ERRCODE = '02000';
  END IF;
  IF NOT private.staff_can_on_unit(v_lease.unit_id, 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل شروط العقد' USING ERRCODE = '42501';
  END IF;
  IF v_lease.status <> 'active' THEN
    RAISE EXCEPTION 'يُصحَّح العقد الساري فقط' USING ERRCODE = '22023';
  END IF;
  IF private.lease_has_money(_lease_id) THEN
    RAISE EXCEPTION 'على العقد دفعات مسجّلة أو فاتورة — لا يُصحَّح، أنهِه وأنشئ عقدًا جديدًا' USING ERRCODE = '22023';
  END IF;
  IF _deposit <> v_lease.deposit AND v_lease.deposit_status <> 'held' THEN
    RAISE EXCEPTION 'سبقت تسوية الوديعة — لا يتغير مبلغها' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.payments WHERE lease_id = _lease_id;
  UPDATE public.leases SET
    start_date = _start_date,
    end_date = (_start_date + make_interval(months => _term_months) - INTERVAL '1 day')::date,
    term_months = _term_months, annual_rent = _annual_rent, installments = _installments,
    deposit = _deposit,
    -- The Ejar terms that were flagged are what the staff member just reviewed (cleared when they
    -- may manage Ejar on this unit; the lease guard requires it).
    ejar_mismatch = CASE WHEN private.staff_can_on_unit(v_lease.unit_id, 'ejar') THEN NULL
                         ELSE ejar_mismatch END
  WHERE id = _lease_id;
  -- The deposit rides on the first installment, whatever the number of installments.
  INSERT INTO public.payments (lease_id, amount, deposit_amount, due_date, status)
  SELECT _lease_id, s.amount + CASE WHEN s.seq = 1 THEN _deposit ELSE 0 END,
         CASE WHEN s.seq = 1 THEN _deposit ELSE 0 END, s.due_date, 'due'
  FROM private.lease_schedule(_start_date, _term_months, _annual_rent, _installments) s;

  BEGIN
    PERFORM public.notify_lease_tenant(
      _lease_id, 'صُحّحت بيانات عقدك',
      format('العقد من %s لمدة %s شهرًا بإيجار سنوي %s ريال على %s دفعات — راجع جدول الدفعات.',
             _start_date, _term_months, to_char(_annual_rent, 'FM999G999G999G990D00'), _installments),
      '/tenant-dashboard#payments');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public.correct_lease(uuid, date, integer, numeric, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_lease(uuid, date, integer, numeric, integer, numeric) TO authenticated;
