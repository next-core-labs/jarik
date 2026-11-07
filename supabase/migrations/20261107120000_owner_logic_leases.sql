-- =============================================================================================
-- Leases & money (owner-logic review 2026-11-07, package P3: C1 H5 H6 M8 M9 M10 M11 M12 L6 L7 L8).
--
--  * Leases can end: end_lease() (staff of the unit's office, or an agreement office with
--    renewal_eviction) records the move-out, drops unpaid installments after it, frees the unit
--    and keeps the deposit held for settlement. Leases past end_date are never ended
--    automatically; a nightly notice tells each office which ones still need a decision.
--  * Renewal transfers the deposit (source lease → 'renewed', deposit 'transferred'), refuses a
--    renewal the owner declined, marks both sides' decisions handled, and builds the schedule
--    with calendar-month due dates (private.lease_schedule, mirrored in lease-schedule.ts).
--  * One active lease per unit, enforced by a trigger (not an index: live data is not checked
--    here, see the report at the end); new leases are created atomically by create_lease().
--  * Partial payments: payments.amount_paid, record_payment(); every total here sums amount_paid.
--    Staff can correct or void a lease that has nothing paid; they can reject a transfer notice.
--  * Office money totals and payment lists come from aggregates/paged RPCs (no 1000-row cap).
--  * Renewal decisions only inside the 90-day window of an active lease; Riyadh dates in the
--    reminder/overdue functions; Ejar terms that disagree are stored for review.
-- Every CREATE OR REPLACE below starts from the newest definition of that object and keeps its
-- existing behaviour unless a comment says otherwise. Replaying the file is safe: columns use
-- IF NOT EXISTS, constraints/triggers/cron jobs are dropped or checked first, backfills are
-- idempotent.
-- =============================================================================================

-- 1) Columns -----------------------------------------------------------------------------------
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS amount_paid numeric NOT NULL DEFAULT 0;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transfer_rejected_note text;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS moved_out_on date;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS end_note text;
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS ended_at timestamptz;
-- Ejar's own terms for a linked contract when they disagree with ours ({start_date, end_date,
-- annual_rent, contract_no, checked_at}); NULL when they agree. Nothing is overwritten by a sync.
ALTER TABLE public.leases ADD COLUMN IF NOT EXISTS ejar_mismatch jsonb;

-- Everything already marked paid was paid in full.
UPDATE public.payments SET amount_paid = amount
WHERE status = 'paid' AND amount_paid IS DISTINCT FROM amount;

DO $$
BEGIN
  -- NOT VALID: legacy rows (payments_amount_nonneg is NOT VALID too) are not re-checked.
  ALTER TABLE public.payments ADD CONSTRAINT payments_amount_paid_range
    CHECK (amount_paid >= 0 AND amount_paid <= amount) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.payments ADD CONSTRAINT payments_transfer_rejected_note_len
    CHECK (transfer_rejected_note IS NULL OR char_length(transfer_rejected_note) <= 300) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TABLE public.leases ADD CONSTRAINT leases_end_note_len
    CHECK (end_note IS NULL OR char_length(end_note) <= 400) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Payment rows keep amount_paid and status in step ------------------------------------------
-- Older writers (and any direct PATCH) still mark a payment paid with status = 'paid' only; that
-- means "paid in full". A new transfer notice clears the office's previous rejection.
CREATE OR REPLACE FUNCTION private.sync_payment_amount_paid() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'paid' AND NEW.amount_paid < NEW.amount
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'paid') THEN
    NEW.amount_paid := NEW.amount;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.transfer_reference IS NOT NULL
     AND NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference THEN
    NEW.transfer_rejected_note := NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.sync_payment_amount_paid() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS b_sync_payment_amount_paid ON public.payments;
CREATE TRIGGER b_sync_payment_amount_paid BEFORE INSERT OR UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION private.sync_payment_amount_paid();

-- 3) Lease guards ------------------------------------------------------------------------------
-- Same as 20261107110000 (P2: tenant of the unit's office, checked only when tenant/unit is set;
-- "home" is the property's office), plus: the end-of-lease columns travel with the status change
-- (renewal_eviction), and ejar_mismatch with the Ejar columns (ejar).
CREATE OR REPLACE FUNCTION private.guard_lease_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE home_org_ok boolean;
BEGIN
  IF NEW.tenant_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
          OR NEW.unit_id IS DISTINCT FROM OLD.unit_id)
     AND (SELECT t.org_id FROM public.tenants t WHERE t.id = NEW.tenant_id)
         IS DISTINCT FROM private.unit_office(NEW.unit_id) THEN
    RAISE EXCEPTION 'المستأجر ليس من نفس مكتب الوحدة' USING ERRCODE = '42501';
  END IF;
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;
  home_org_ok := private.staff_scope_ok(
    private.unit_property_org(CASE WHEN TG_OP = 'UPDATE' THEN OLD.unit_id ELSE NEW.unit_id END));
  IF home_org_ok THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
      RAISE EXCEPTION 'صلاحيتك لا تشمل إنشاء عقد جديد' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الوحدة المرتبطة بالعقد' USING ERRCODE = '42501';
  END IF;
  IF (NEW.ejar_contract_no IS DISTINCT FROM OLD.ejar_contract_no
      OR NEW.ejar_status IS DISTINCT FROM OLD.ejar_status
      OR NEW.ejar_mismatch IS DISTINCT FROM OLD.ejar_mismatch)
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'ejar') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل إدارة إيجار (فال)' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('ended', 'terminated')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'renewal_eviction') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل الإنهاء أو الإخلاء' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'ejar_contract_no' - 'ejar_status' - 'ejar_mismatch' - 'status'
        - 'moved_out_on' - 'end_note' - 'ended_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'ejar_contract_no' - 'ejar_status' - 'ejar_mismatch' - 'status'
        - 'moved_out_on' - 'end_note' - 'ended_at' - 'updated_at')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل شروط العقد' USING ERRCODE = '42501';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('ended', 'terminated')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل حالة العقد' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_lease_agreement_columns() FROM PUBLIC, anon, authenticated;

-- Same as 20260924090000, but only when a lease is placed on a unit (INSERT, unit change, or
-- becoming active again): ending an old lease on a unit later put up for sale must still work.
CREATE OR REPLACE FUNCTION private.guard_no_lease_on_sale_unit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.unit_id IS NOT DISTINCT FROM OLD.unit_id
     AND NOT (NEW.status = 'active' AND OLD.status IS DISTINCT FROM 'active') THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.units u WHERE u.id = NEW.unit_id AND u.listing_purpose = 'sale') THEN
    RAISE EXCEPTION 'لا يمكن إنشاء عقد إيجار على وحدة مطروحة للبيع' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_no_lease_on_sale_unit() FROM PUBLIC;

-- One active lease per unit. A trigger rather than a unique index: live data may already hold
-- duplicates (reported at the end of this file), and those must not stop the migration. The
-- advisory lock serialises concurrent inserts for the same unit; the EXISTS runs after it with a
-- fresh snapshot, so the second of two racing inserts sees the first. renew_lease sets
-- jarak.renewing_lease to its source lease, which is about to become 'renewed' in the same
-- transaction.
CREATE OR REPLACE FUNCTION private.guard_one_active_lease() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _renewing uuid := private.try_uuid(current_setting('jarak.renewing_lease', true));
BEGIN
  IF NEW.status IS DISTINCT FROM 'active' THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.unit_id IS NOT DISTINCT FROM OLD.unit_id THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('lease_unit:' || NEW.unit_id::text));
  IF EXISTS (
    SELECT 1 FROM public.leases l
    WHERE l.unit_id = NEW.unit_id AND l.status = 'active' AND l.id <> NEW.id
      AND l.id IS DISTINCT FROM _renewing
  ) THEN
    RAISE EXCEPTION 'على هذه الوحدة عقد ساري — أنهِه أو جدّده أولًا' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_one_active_lease() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS y_guard_one_active_lease ON public.leases;
CREATE TRIGGER y_guard_one_active_lease BEFORE INSERT OR UPDATE OF status, unit_id ON public.leases
FOR EACH ROW EXECUTE FUNCTION private.guard_one_active_lease();

-- 4) Legacy renewals ---------------------------------------------------------------------------
-- renew_lease used to mark its source 'expired' and copy the deposit as 'held' onto the new
-- lease, so the same money could be refunded twice. A source lease is one followed by a later
-- lease of the same tenant on the same unit.
UPDATE public.leases s SET
  status = 'renewed',
  deposit_status = CASE WHEN s.deposit_status = 'held' THEN 'transferred' ELSE s.deposit_status END,
  deposit_note = CASE WHEN s.deposit_status = 'held' AND s.deposit > 0
                      THEN COALESCE(s.deposit_note, 'نُقلت الوديعة إلى العقد المجدَّد')
                      ELSE s.deposit_note END
WHERE s.status = 'expired'
  AND EXISTS (
    SELECT 1 FROM public.leases n
    WHERE n.unit_id = s.unit_id AND n.tenant_id = s.tenant_id AND n.id <> s.id
      AND n.start_date > s.end_date
  );

-- 5) Shared helpers ----------------------------------------------------------------------------
/**
 * Staff of the office that registered the unit's property, or of an office whose live agreement on
 * it grants `_perm` (P2's private.unit_scope_ok, limited to signed-in staff).
 */
CREATE OR REPLACE FUNCTION private.staff_can_on_unit(_unit_id uuid, _perm text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND public.is_staff(auth.uid())
     AND private.unit_scope_ok(_unit_id, ARRAY[_perm])
$$;
REVOKE ALL ON FUNCTION private.staff_can_on_unit(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.staff_can_on_unit(uuid, text) TO authenticated, service_role;

/**
 * A lease's payment schedule. The contract total is the annual rent's share for the term, split
 * into whole halalas with the remainder on the last installment. Installment i (0-based) falls
 * due floor(i × term / count) calendar months after the start; a day the month doesn't have
 * becomes its last day (Jan 31 + 1 month → Feb 28/29), counted from the start each time.
 * src/components/lease-schedule.ts builds the same rows for the «عقد جديد» preview.
 */
CREATE OR REPLACE FUNCTION private.lease_schedule(
  _start date, _term_months integer, _annual_rent numeric, _installments integer
) RETURNS TABLE(seq integer, amount numeric, due_date date)
LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  v_total bigint := round(round(_annual_rent * _term_months / 12.0, 2) * 100)::bigint;
  v_base bigint;
  i integer;
BEGIN
  v_base := round(v_total::numeric / _installments)::bigint;
  IF v_total - v_base * (_installments - 1) < 0 THEN
    v_base := floor(v_total::numeric / _installments)::bigint;
  END IF;
  FOR i IN 0..(_installments - 1) LOOP
    seq := i + 1;
    amount := CASE WHEN i = _installments - 1
                   THEN (v_total - v_base * (_installments - 1)) / 100.0
                   ELSE v_base / 100.0 END;
    due_date := (_start + make_interval(months => (i * _term_months) / _installments))::date;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.lease_schedule(date, integer, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.lease_schedule(date, integer, numeric, integer) TO authenticated, service_role;

/** The checks every lease writer applies to its terms (same messages as renew_lease). */
CREATE OR REPLACE FUNCTION private.check_lease_terms(
  _start date, _term_months integer, _annual_rent numeric, _installments integer
) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _start IS NULL THEN
    RAISE EXCEPTION 'أدخل تاريخ بدء العقد' USING ERRCODE = '22023';
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
END $$;
REVOKE ALL ON FUNCTION private.check_lease_terms(date, integer, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.check_lease_terms(date, integer, numeric, integer) TO authenticated, service_role;

-- 6) Creating a lease (M8) ---------------------------------------------------------------------
-- Replaces the browser's tenant → lease → payments inserts with manual rollback. SECURITY INVOKER:
-- the caller's own row-level security and every lease guard apply exactly as before; the function
-- only makes the three writes one transaction. The tenant row belongs to the unit's office.
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

  IF v_tenant IS NULL THEN
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

  INSERT INTO public.payments (lease_id, amount, due_date, status)
  SELECT v_lease, s.amount, s.due_date, 'due'
  FROM private.lease_schedule(_start_date, _term_months, _annual_rent, _installments) s;

  RETURN v_lease;
END $$;
REVOKE ALL ON FUNCTION public.create_lease(uuid, uuid, jsonb, date, integer, numeric, integer, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_lease(uuid, uuid, jsonb, date, integer, numeric, integer, numeric) TO authenticated;

-- 7) Renewing a lease (H5, M9, M10) ------------------------------------------------------------
-- Same as 20260928105625 except: authorisation is staff_can_on_unit(…, 'leasing') (the property's
-- office, or an agreement office with leasing, as P2's lease policies); the owner's "leave" decision blocks it; the source becomes
-- 'renewed' (not 'expired') and its held deposit 'transferred' to the new lease, which is the only
-- one holding it; both sides' open decisions are marked handled; the schedule uses
-- private.lease_schedule (calendar months).
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
  v_owner_decision text;
BEGIN
  IF _start_date IS NULL THEN
    RAISE EXCEPTION 'أدخل تاريخ بدء العقد الجديد' USING ERRCODE = '22023';
  END IF;
  PERFORM private.check_lease_terms(_start_date, _term_months, _annual_rent, _installments);

  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source FROM public.leases WHERE id = _source_lease_id FOR UPDATE;
  IF NOT FOUND OR v_source.status <> 'active' THEN
    RAISE EXCEPTION 'العقد المصدر غير موجود أو لم يعد ساريًا' USING ERRCODE = '02000';
  END IF;

  IF NOT private.staff_can_on_unit(v_source.unit_id, 'leasing') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على وحدة هذا العقد' USING ERRCODE = '42501';
  END IF;

  SELECT d.decision INTO v_owner_decision
  FROM public.owner_renewal_decisions d
  WHERE d.lease_id = v_source.id AND d.status <> 'superseded'
  ORDER BY d.created_at DESC LIMIT 1;
  IF v_owner_decision = 'leave' THEN
    RAISE EXCEPTION 'المالك اختار عدم التجديد لهذا العقد — لا يُجدَّد إلا إذا غيّر المالك قراره'
      USING ERRCODE = '42501';
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

  -- The source is still active until the UPDATE below; the one-active-lease guard lets this
  -- insert through for it alone (unit stays occupied throughout, no vacant blip).
  PERFORM set_config('jarak.renewing_lease', v_source.id::text, true);
  INSERT INTO public.leases (
    unit_id, tenant_id, start_date, end_date, annual_rent, term_months, installments, deposit,
    deposit_status, status, ejar_status
  ) VALUES (
    v_source.unit_id, v_source.tenant_id, _start_date, v_end_date, _annual_rent, _term_months,
    _installments,
    CASE WHEN v_source.deposit_status = 'held' THEN v_source.deposit ELSE 0 END,
    'held', 'active', 'pending'
  )
  RETURNING id INTO v_new_lease_id;

  INSERT INTO public.payments (lease_id, amount, due_date, status)
  SELECT v_new_lease_id, s.amount, s.due_date, 'due'
  FROM private.lease_schedule(_start_date, _term_months, _annual_rent, _installments) s;

  UPDATE public.leases SET
    status = 'renewed',
    deposit_status = CASE WHEN deposit_status = 'held' THEN 'transferred' ELSE deposit_status END,
    deposit_note = CASE WHEN deposit_status = 'held' AND deposit > 0
                        THEN 'نُقلت الوديعة إلى العقد المجدَّد' ELSE deposit_note END
  WHERE id = v_source.id;
  PERFORM set_config('jarak.renewing_lease', '', true);

  UPDATE public.owner_renewal_decisions SET status = 'handled', updated_at = now()
  WHERE lease_id = v_source.id AND status = 'new';
  UPDATE public.renewal_requests SET status = 'handled', updated_at = now()
  WHERE lease_id = v_source.id AND status = 'new';

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

-- 8) Ending a lease (C1, product decision 3) ---------------------------------------------------
-- _reason: 'ended' (normal end) or 'terminated' (early). The move-out day is today or earlier.
-- Unpaid installments due after it are removed (a partly paid one keeps what was paid); the
-- deposit stays held for settlement; the unit becomes vacant from the move-out day.
CREATE OR REPLACE FUNCTION public.end_lease(
  _lease_id uuid, _move_out date, _reason text, _note text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lease public.leases%ROWTYPE;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_note text := NULLIF(left(btrim(COALESCE(_note, '')), 400), '');
  v_removed integer;
BEGIN
  IF _reason IS NULL OR _reason NOT IN ('ended', 'terminated') THEN
    RAISE EXCEPTION 'اختر سبب الإنهاء: انتهاء المدة أو فسخ مبكر' USING ERRCODE = '22023';
  END IF;
  IF _move_out IS NULL THEN
    RAISE EXCEPTION 'حدّد تاريخ الإخلاء' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_lease FROM public.leases WHERE id = _lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد العقد' USING ERRCODE = '02000';
  END IF;
  IF NOT private.staff_can_on_unit(v_lease.unit_id, 'renewal_eviction') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل الإنهاء أو الإخلاء' USING ERRCODE = '42501';
  END IF;
  IF v_lease.status <> 'active' THEN
    RAISE EXCEPTION 'العقد ليس ساريًا' USING ERRCODE = '22023';
  END IF;
  IF _move_out > v_today THEN
    RAISE EXCEPTION 'تاريخ الإخلاء لا يكون في المستقبل — سجّل الإنهاء يوم الإخلاء' USING ERRCODE = '22023';
  END IF;
  IF _move_out < v_lease.start_date THEN
    RAISE EXCEPTION 'تاريخ الإخلاء قبل بداية العقد' USING ERRCODE = '22023';
  END IF;

  -- Installments due after the move-out: drop the unpaid ones, close a partly paid one at what
  -- was paid.
  DELETE FROM public.payments
  WHERE lease_id = _lease_id AND due_date > _move_out AND status <> 'paid' AND amount_paid = 0;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  UPDATE public.payments SET amount = amount_paid, status = 'paid'
  WHERE lease_id = _lease_id AND due_date > _move_out AND status <> 'paid' AND amount_paid > 0;

  UPDATE public.leases SET
    status = _reason, moved_out_on = _move_out, end_note = v_note, ended_at = now()
  WHERE id = _lease_id;

  UPDATE public.owner_renewal_decisions SET status = 'handled', updated_at = now()
  WHERE lease_id = _lease_id AND status = 'new';
  UPDATE public.renewal_requests SET status = 'handled', updated_at = now()
  WHERE lease_id = _lease_id AND status = 'new';

  -- sync_unit_status made the unit vacant (now); it has been vacant since the move-out.
  BEGIN
    UPDATE public.units SET vacant_since = (_move_out::timestamp AT TIME ZONE 'Asia/Riyadh')
    WHERE id = v_lease.unit_id AND status = 'vacant';
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    PERFORM public.notify_lease_tenant(
      _lease_id,
      CASE WHEN _reason = 'terminated' THEN 'فُسخ عقد الإيجار' ELSE 'انتهى عقد الإيجار' END,
      format('سُجّل إخلاء الوحدة بتاريخ %s.%s الوديعة محجوزة حتى تسويتها.',
             _move_out,
             CASE WHEN v_removed > 0 THEN format(' أُلغيت %s دفعة كانت تستحق بعد الإخلاء.', v_removed) ELSE '' END),
      '/tenant-dashboard#contract'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.notify_unit(
      v_lease.unit_id,
      CASE WHEN _reason = 'terminated' THEN 'فُسخ عقد الوحدة' ELSE 'انتهى عقد الوحدة' END,
      format('أُخليت الوحدة بتاريخ %s وأصبحت شاغرة.', _move_out),
      'lease'
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public.end_lease(uuid, date, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.end_lease(uuid, date, text, text) TO authenticated;

-- 9) Correcting or voiding a lease (M12) -------------------------------------------------------
-- Only an active lease with nothing paid on it (no installment with money recorded, deposit not
-- settled, no invoice). Correcting rewrites the terms and regenerates the schedule.
CREATE OR REPLACE FUNCTION private.lease_has_money(_lease_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.payments p
                 WHERE p.lease_id = _lease_id AND (p.status = 'paid' OR p.amount_paid > 0))
      OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.lease_id = _lease_id)
$$;
REVOKE ALL ON FUNCTION private.lease_has_money(uuid) FROM PUBLIC, anon, authenticated;

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
  INSERT INTO public.payments (lease_id, amount, due_date, status)
  SELECT _lease_id, s.amount, s.due_date, 'due'
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

-- Voiding deletes a lease entered by mistake (the audit log keeps the row). A voided renewal hands
-- the tenancy and the deposit back to the lease it renewed.
CREATE OR REPLACE FUNCTION public.void_lease(_lease_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_lease public.leases%ROWTYPE;
  v_source uuid;
BEGIN
  SELECT * INTO v_lease FROM public.leases WHERE id = _lease_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد العقد' USING ERRCODE = '02000';
  END IF;
  IF NOT private.staff_can_on_unit(v_lease.unit_id, 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل إلغاء العقد' USING ERRCODE = '42501';
  END IF;
  IF v_lease.status <> 'active' THEN
    RAISE EXCEPTION 'يُلغى العقد الساري فقط' USING ERRCODE = '22023';
  END IF;
  IF private.lease_has_money(_lease_id) OR v_lease.deposit_status <> 'held' THEN
    RAISE EXCEPTION 'على العقد دفعات أو وديعة مسوّاة أو فاتورة — لا يُلغى، أنهِه بدل ذلك' USING ERRCODE = '22023';
  END IF;

  SELECT s.id INTO v_source FROM public.leases s
  WHERE s.unit_id = v_lease.unit_id AND s.tenant_id = v_lease.tenant_id
    AND s.status = 'renewed' AND s.end_date < v_lease.start_date
  ORDER BY s.end_date DESC LIMIT 1;

  BEGIN
    PERFORM public.notify_lease_tenant(
      COALESCE(v_source, _lease_id), 'أُلغي عقد أُدخل بالخطأ',
      format('ألغى المكتب العقد من %s إلى %s ودفعاته.', v_lease.start_date, v_lease.end_date),
      '/tenant-dashboard#contract');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  DELETE FROM public.leases WHERE id = _lease_id;

  IF v_source IS NOT NULL THEN
    UPDATE public.leases SET
      status = 'active',
      deposit_status = CASE WHEN deposit_status = 'transferred' THEN 'held' ELSE deposit_status END,
      deposit_note = CASE WHEN deposit_status = 'transferred' THEN NULL ELSE deposit_note END
    WHERE id = v_source;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.void_lease(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_lease(uuid) TO authenticated;

-- 10) Recording money and transfer notices (M12, L6) -------------------------------------------
-- Adds _amount to what was already paid on the installment: less than what remains keeps it open
-- ('partial'), the rest closes it ('paid').
CREATE OR REPLACE FUNCTION public.record_payment(
  _payment_id uuid, _amount numeric, _paid_date date, _method text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_remaining numeric;
  v_new_paid numeric;
  v_status text;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد الدفعة' USING ERRCODE = '02000';
  END IF;
  -- Same rule as P2's payments update policy: the property's office, or `collection`.
  IF NOT private.staff_can_on_unit(private.lease_unit(v_pay.lease_id), 'collection') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذه الدفعة' USING ERRCODE = '42501';
  END IF;
  IF v_pay.status = 'paid' THEN
    RAISE EXCEPTION 'سبق تسجيل سداد هذه الدفعة' USING ERRCODE = '22023';
  END IF;
  IF _paid_date IS NULL THEN
    RAISE EXCEPTION 'اختر تاريخ السداد' USING ERRCODE = '22023';
  END IF;
  IF _paid_date > (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
    RAISE EXCEPTION 'تاريخ السداد لا يكون في المستقبل' USING ERRCODE = '22023';
  END IF;
  v_remaining := v_pay.amount - v_pay.amount_paid;
  IF _amount IS NULL OR _amount <= 0 OR _amount <> round(_amount, 2) THEN
    RAISE EXCEPTION 'أدخل المبلغ المستلم بالريال (منزلتان عشريتان كحد أقصى)' USING ERRCODE = '22023';
  END IF;
  IF _amount > v_remaining THEN
    RAISE EXCEPTION 'المبلغ أكبر من المتبقي على الدفعة (% ر.س)', v_remaining USING ERRCODE = '22023';
  END IF;

  v_new_paid := v_pay.amount_paid + _amount;
  v_status := CASE WHEN v_new_paid >= v_pay.amount THEN 'paid' ELSE 'partial' END;
  UPDATE public.payments SET
    amount_paid = v_new_paid, status = v_status, paid_date = _paid_date,
    method = NULLIF(btrim(COALESCE(_method, '')), ''), collected_by = auth.uid()
  WHERE id = _payment_id;

  -- A completed installment is announced by on_payment_paid; a partial one only to its tenant.
  IF v_status = 'partial' THEN
    BEGIN
      PERFORM public.notify_lease_tenant(
        v_pay.lease_id, 'سُجّلت دفعة جزئية',
        format('استلم المكتب %s ريال من دفعة %s ريال المستحقة %s — المتبقي %s ريال.',
               to_char(_amount, 'FM999G999G990D00'), to_char(v_pay.amount, 'FM999G999G990D00'),
               v_pay.due_date, to_char(v_pay.amount - v_new_paid, 'FM999G999G990D00')),
        '/tenant-dashboard#payments');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  RETURN jsonb_build_object('status', v_status, 'amount_paid', v_new_paid,
                            'remaining', v_pay.amount - v_new_paid);
END $$;
REVOKE ALL ON FUNCTION public.record_payment(uuid, numeric, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_payment(uuid, numeric, date, text) TO authenticated;

-- The office did not receive the transfer the tenant reported: clear the notice, keep the reason
-- on the installment for the tenant, and tell them.
CREATE OR REPLACE FUNCTION public.reject_transfer_notice(_payment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_reason text := NULLIF(left(btrim(COALESCE(_reason, '')), 300), '');
BEGIN
  IF v_reason IS NULL OR char_length(v_reason) < 3 THEN
    RAISE EXCEPTION 'اكتب سبب الرفض ليصل للمستأجر' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد الدفعة' USING ERRCODE = '02000';
  END IF;
  -- Same rule as P2's payments update policy: the property's office, or `collection`.
  IF NOT private.staff_can_on_unit(private.lease_unit(v_pay.lease_id), 'collection') THEN
    RAISE EXCEPTION 'ليس لديك صلاحية على هذه الدفعة' USING ERRCODE = '42501';
  END IF;
  IF v_pay.status = 'paid' THEN
    RAISE EXCEPTION 'الدفعة مسدّدة — لا يوجد إبلاغ لرفضه' USING ERRCODE = '22023';
  END IF;
  IF v_pay.transfer_reference IS NULL THEN
    RAISE EXCEPTION 'لا يوجد إبلاغ تحويل على هذه الدفعة' USING ERRCODE = '22023';
  END IF;

  UPDATE public.payments SET
    transfer_reference = NULL, transfer_submitted_at = NULL, transfer_rejected_note = v_reason
  WHERE id = _payment_id;

  BEGIN
    PERFORM public.notify_lease_tenant(
      v_pay.lease_id, 'لم يؤكد المكتب تحويلك',
      format('إبلاغك عن تحويل دفعة %s ريال (استحقاق %s) بالمرجع %s لم يُعتمد: %s',
             to_char(v_pay.amount, 'FM999G999G990D00'), v_pay.due_date, v_pay.transfer_reference, v_reason),
      '/tenant-dashboard#payments');
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
REVOKE ALL ON FUNCTION public.reject_transfer_notice(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_transfer_notice(uuid, text) TO authenticated;

-- The tenant asks the office for more time or instalments on one of their own open payments.
-- (The dashboard called notify_unit_staff, which is staff-only, so the request never arrived.)
-- One request per payment per day reaches the office's staff.
CREATE OR REPLACE FUNCTION public.request_payment_grace(_payment_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pay record;
  v_org uuid;
BEGIN
  SELECT p.id, p.amount, p.amount_paid, p.due_date, p.status, p.lease_id, t.full_name,
         u.unit_number, pr.name AS property_name
  INTO v_pay
  FROM public.payments p
  JOIN public.leases l ON l.id = p.lease_id
  JOIN public.tenants t ON t.id = l.tenant_id
  LEFT JOIN public.units u ON u.id = l.unit_id
  LEFT JOIN public.properties pr ON pr.id = u.property_id
  WHERE p.id = _payment_id AND auth.uid() IS NOT NULL AND t.user_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لم نجد هذه الدفعة في حسابك' USING ERRCODE = '42501';
  END IF;
  IF v_pay.status = 'paid' THEN
    RAISE EXCEPTION 'هذه الدفعة مسدّدة' USING ERRCODE = '22023';
  END IF;
  v_org := private.org_of_lease(v_pay.lease_id);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'لا يوجد مكتب يدير هذا العقد حاليًا' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.notifications n
    WHERE n.related_table = 'payments' AND n.related_id = _payment_id AND n.kind = 'payment'
      AND n.title = 'طلب مهلة أو تقسيط'
      AND n.created_at > now() - interval '1 day'
  ) THEN
    RAISE EXCEPTION 'وصل طلبك للمكتب اليوم — سيتواصلون معك' USING ERRCODE = '23505';
  END IF;
  PERFORM private.notify_org_staff(
    v_org, 'طلب مهلة أو تقسيط',
    format('%s (%s وحدة %s) يطلب مهلة أو تقسيطًا للدفعة %s ريال المستحقة %s.',
           v_pay.full_name, COALESCE(v_pay.property_name, ''), COALESCE(v_pay.unit_number, '-'),
           to_char(v_pay.amount - v_pay.amount_paid, 'FM999G999G990D00'), v_pay.due_date),
    'payment', 'payments', _payment_id);
END $$;
REVOKE ALL ON FUNCTION public.request_payment_grace(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_payment_grace(uuid) TO authenticated;

-- 11) Office money: aggregates and paged lists (H6) --------------------------------------------
-- SECURITY INVOKER: they sum and page exactly the rows the caller's row-level security already
-- shows them on /collections and /dashboard, without PostgREST's 1000-row cap.
CREATE OR REPLACE FUNCTION public.office_finance_summary()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d),
  pay AS (
    SELECT p.amount, p.amount_paid, p.status, p.due_date
    FROM public.payments p
    WHERE public.is_staff(auth.uid())
  )
  SELECT jsonb_build_object(
    'today', (SELECT d FROM today),
    'collected', COALESCE((SELECT sum(amount_paid) FROM pay), 0),
    'outstanding', COALESCE((SELECT sum(amount - amount_paid) FROM pay WHERE status <> 'paid'), 0),
    'overdue_total', COALESCE((SELECT sum(amount - amount_paid) FROM pay
                               WHERE status <> 'paid' AND due_date < (SELECT d FROM today)), 0),
    'overdue_count', (SELECT count(*) FROM pay
                      WHERE status <> 'paid' AND due_date < (SELECT d FROM today)),
    'remind_count', (SELECT count(*) FROM pay
                     WHERE status <> 'paid' AND due_date <= (SELECT d FROM today) + 7),
    'payments_count', (SELECT count(*) FROM pay),
    'expenses_total', COALESCE((SELECT sum(e.amount) FROM public.expenses e
                                WHERE public.is_staff(auth.uid())), 0),
    'units_total', (SELECT count(*) FROM public.units u
                    WHERE public.is_staff(auth.uid()) AND u.status <> 'sold'),
    'units_occupied', (SELECT count(*) FROM public.units u
                       WHERE public.is_staff(auth.uid()) AND u.status = 'occupied'),
    'units_vacant', (SELECT count(*) FROM public.units u
                     WHERE public.is_staff(auth.uid()) AND u.status = 'vacant')
  )
$$;
REVOKE ALL ON FUNCTION public.office_finance_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_finance_summary() TO authenticated;

-- _status: all | open (not fully paid) | overdue | due (open, not yet overdue) | paid | remind
-- (open and due within 7 days or overdue). _order: due (oldest due first) | amount (largest
-- remaining first). total_count is the number of matching rows before paging.
CREATE OR REPLACE FUNCTION public.office_payments(
  _status text DEFAULT 'all', _from date DEFAULT NULL, _to date DEFAULT NULL,
  _search text DEFAULT NULL, _order text DEFAULT 'due', _limit integer DEFAULT 50,
  _offset integer DEFAULT 0
) RETURNS TABLE(
  id uuid, lease_id uuid, amount numeric, amount_paid numeric, due_date date, paid_date date,
  status text, method text, last_reminded_at timestamptz, transfer_reference text,
  transfer_submitted_at timestamptz, tenant_name text, tenant_user_id uuid, tenant_phone text,
  unit_number text, property_name text, total_count bigint
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d),
  matched AS (
    SELECT p.id, p.lease_id, p.amount, p.amount_paid, p.due_date, p.paid_date, p.status, p.method,
           p.last_reminded_at, p.transfer_reference, p.transfer_submitted_at,
           t.full_name AS tenant_name, t.user_id AS tenant_user_id, t.phone AS tenant_phone,
           u.unit_number, pr.name AS property_name
    FROM public.payments p
    LEFT JOIN public.leases l ON l.id = p.lease_id
    LEFT JOIN public.tenants t ON t.id = l.tenant_id
    LEFT JOIN public.units u ON u.id = l.unit_id
    LEFT JOIN public.properties pr ON pr.id = u.property_id
    CROSS JOIN today
    WHERE public.is_staff(auth.uid())
      AND CASE COALESCE(_status, 'all')
            WHEN 'paid' THEN p.status = 'paid'
            WHEN 'open' THEN p.status <> 'paid'
            WHEN 'overdue' THEN p.status <> 'paid' AND p.due_date < today.d
            WHEN 'due' THEN p.status <> 'paid' AND p.due_date >= today.d
            WHEN 'remind' THEN p.status <> 'paid' AND p.due_date <= today.d + 7
            ELSE true END
      AND (_from IS NULL OR p.due_date >= _from)
      AND (_to IS NULL OR p.due_date <= _to)
      AND (NULLIF(btrim(COALESCE(_search, '')), '') IS NULL
           OR strpos(lower(concat_ws(' ', t.full_name, u.unit_number, pr.name)),
                     lower(btrim(_search))) > 0)
  )
  SELECT r.*, count(*) OVER () AS total_count
  FROM matched r
  ORDER BY
    CASE WHEN _order = 'amount' THEN r.amount - r.amount_paid END DESC NULLS LAST,
    r.due_date, r.id
  LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 1000)
  OFFSET GREATEST(COALESCE(_offset, 0), 0)
$$;
REVOKE ALL ON FUNCTION public.office_payments(text, date, date, text, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_payments(text, date, date, text, text, integer, integer) TO authenticated;

-- 12) Renewal decisions (L7, M10) --------------------------------------------------------------
-- Tenants file renewal requests straight into the table (RLS insert policy) as well as through
-- submitRenewalDecision: the window and the one-open-request rule live here for both.
CREATE OR REPLACE FUNCTION private.guard_renewal_request() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lease record;
BEGIN
  SELECT l.status, l.end_date INTO v_lease FROM public.leases l WHERE l.id = NEW.lease_id;
  IF NOT FOUND OR v_lease.status <> 'active' THEN
    RAISE EXCEPTION 'هذا العقد ليس ساريًا' USING ERRCODE = '22023';
  END IF;
  IF v_lease.end_date > (now() AT TIME ZONE 'Asia/Riyadh')::date + 90 THEN
    RAISE EXCEPTION 'خيار التجديد أو الإخلاء يُفتح قبل ٩٠ يومًا من نهاية العقد' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.renewal_requests r
             WHERE r.lease_id = NEW.lease_id AND r.status = 'new') THEN
    RAISE EXCEPTION 'لديك طلب قائم لهذا العقد — بانتظار رد المكتب' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_renewal_request() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_renewal_request ON public.renewal_requests;
CREATE TRIGGER guard_renewal_request BEFORE INSERT ON public.renewal_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_renewal_request();

-- Same as 20261008120000, plus: the lease's owner (leases.owner_id, M13) decides; the lease must
-- end within 90 days (Riyadh); the proposed rent is kept to the halala (it was silently rounded to
-- whole riyals) or refused.
CREATE OR REPLACE FUNCTION public.owner_submit_renewal_decision(
  _lease_id uuid, _decision text, _proposed_rent numeric DEFAULT NULL, _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _end date;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  SELECT l.end_date INTO _end FROM public.leases l
  WHERE l.id = _lease_id AND l.status = 'active' AND l.owner_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'هذا العقد ليس عقدًا ساريًا على إحدى وحداتك';
  END IF;
  IF _end > (now() AT TIME ZONE 'Asia/Riyadh')::date + 90 THEN
    RAISE EXCEPTION 'قرار التجديد يُفتح قبل ٩٠ يومًا من نهاية العقد';
  END IF;
  IF _decision NOT IN ('renew', 'renew_new_rent', 'leave') THEN
    RAISE EXCEPTION 'قرار غير معروف';
  END IF;
  IF _decision = 'renew_new_rent' AND (_proposed_rent IS NULL OR _proposed_rent <= 0) THEN
    RAISE EXCEPTION 'حدّد الإيجار السنوي الجديد';
  END IF;
  IF _decision = 'renew_new_rent' AND _proposed_rent <> round(_proposed_rent, 2) THEN
    RAISE EXCEPTION 'الإيجار الجديد بحد أقصى منزلتين عشريتين';
  END IF;

  UPDATE public.owner_renewal_decisions SET status = 'superseded', updated_at = now()
  WHERE lease_id = _lease_id AND status = 'new';
  INSERT INTO public.owner_renewal_decisions (lease_id, owner_id, decision, proposed_rent, note)
  VALUES (
    _lease_id, _uid, _decision,
    CASE WHEN _decision = 'renew_new_rent' THEN _proposed_rent END,
    NULLIF(left(trim(COALESCE(_note, '')), 400), '')
  )
  RETURNING id INTO _id;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.owner_submit_renewal_decision(uuid, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_submit_renewal_decision(uuid, text, numeric, text) TO authenticated, service_role;

-- 13) Riyadh dates and amount_paid in the reminder/overdue functions (L8, M12) ---------------
-- Same as 20260922090000 with Riyadh's date instead of the UTC current_date.
CREATE OR REPLACE FUNCTION public.tenant_overdue_count(_tenant_id uuid)
RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT (
    (public.is_staff(auth.uid())
       AND private.is_org_member((SELECT t.org_id FROM public.tenants t WHERE t.id = _tenant_id)))
    OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant_id AND t.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT count(*)::integer INTO n
  FROM public.payments p JOIN public.leases l ON l.id = p.lease_id
  WHERE l.tenant_id = _tenant_id AND p.status <> 'paid'
    AND p.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.tenant_overdue_count(uuid) FROM anon;

-- Same as 20260922090000 with Riyadh's date.
CREATE OR REPLACE FUNCTION public.notify_expiring_leases(_days integer DEFAULT 60) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0; v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT l.unit_id, l.end_date, u.unit_number
    FROM public.leases l JOIN public.units u ON u.id = l.unit_id
    WHERE l.status = 'active'
      AND l.end_date BETWEEN v_today AND v_today + _days
      AND private.org_of_unit(l.unit_id) = private.my_org()
  LOOP
    PERFORM public.notify_unit(r.unit_id,
      'عقد الوحدة ' || r.unit_number || ' ينتهي قريبًا',
      'تاريخ انتهاء العقد: ' || r.end_date::text, 'lease');
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_expiring_leases(integer) FROM anon;

-- Same as 20260927210856 with Riyadh's date, the remaining balance (amount − amount_paid) in the
-- text, and the unit's office (org_of_unit, which covers agreement units) for a staff run.
CREATE OR REPLACE FUNCTION public.smart_payment_reminders() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c int := 0; d int; already boolean; r record;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  v_left numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT pay.id, pay.amount, pay.amount_paid, pay.due_date, t.user_id, u.unit_number,
           pr.name AS property_name
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    JOIN public.tenants t ON t.id = l.tenant_id
    LEFT JOIN public.units u ON u.id = l.unit_id
    LEFT JOIN public.properties pr ON pr.id = u.property_id
    WHERE pay.status <> 'paid' AND t.user_id IS NOT NULL
      AND pay.due_date <= (v_today + 7)
      AND (auth.uid() IS NULL OR private.org_of_unit(l.unit_id) = private.my_org())
  LOOP
    d := r.due_date - v_today;
    IF d NOT IN (7,3,0) OR d < 0 THEN CONTINUE; END IF;
    SELECT EXISTS (
      SELECT 1 FROM public.notifications n
      WHERE n.user_id = r.user_id AND n.kind = 'payment_reminder'
        AND n.related_id = r.id AND (n.created_at AT TIME ZONE 'Asia/Riyadh')::date = v_today
    ) INTO already;
    IF already THEN CONTINUE; END IF;
    v_left := r.amount - COALESCE(r.amount_paid, 0);
    INSERT INTO public.notifications(user_id, title, body, kind, source, related_table, related_id)
    VALUES (
      r.user_id,
      CASE WHEN d = 0 THEN 'دفعتك مستحقة اليوم' ELSE 'تذكير قبل استحقاق دفعتك' END,
      CASE WHEN d = 0
        THEN CONCAT('دفعة ', COALESCE(r.property_name,''), ' - وحدة ', COALESCE(r.unit_number,'-'), ' بمبلغ ', ROUND(r.amount)::text, ' ريال مستحقة اليوم — رصيدك المتبقي ', ROUND(v_left)::text, ' ريال.')
        ELSE CONCAT('دفعة ', COALESCE(r.property_name,''), ' - وحدة ', COALESCE(r.unit_number,'-'), ' بمبلغ ', ROUND(r.amount)::text, ' ريال تستحق بعد ', d::text, ' يوم — رصيدك المتبقي ', ROUND(v_left)::text, ' ريال.')
      END,
      'payment_reminder', 'auto', 'payments', r.id
    );
    c := c + 1;
  END LOOP;
  -- Only the unattended cron run (no auth.uid()) logs to cron_job_runs — a staff member clicking
  -- the manual "remind now" button in the app calls this same function with their own session, and
  -- that isn't a scheduled-job execution the health tab should report on.
  IF auth.uid() IS NULL THEN
    INSERT INTO public.cron_job_runs (job_name, rows_affected) VALUES ('smart-payment-reminders', c);
  END IF;
  RETURN c;
END $$;
REVOKE EXECUTE ON FUNCTION public.smart_payment_reminders() FROM anon;

-- 14) Nightly: leases past their end date with no decision (C1) --------------------------------
-- One notice per office per day to its staff, listing active leases whose end date has passed.
-- Nothing is ended automatically.
CREATE OR REPLACE FUNCTION public.notify_overdue_lease_decisions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT x.org_id, count(*) AS cnt,
           string_agg(x.label, '، ' ORDER BY x.end_date) FILTER (WHERE x.rn <= 10) AS labels
    FROM (
      SELECT private.org_of_unit(l.unit_id) AS org_id, l.end_date,
             format('%s وحدة %s (انتهى %s)', COALESCE(pr.name, ''), u.unit_number, l.end_date) AS label,
             row_number() OVER (PARTITION BY private.org_of_unit(l.unit_id) ORDER BY l.end_date) AS rn
      FROM public.leases l
      JOIN public.units u ON u.id = l.unit_id
      LEFT JOIN public.properties pr ON pr.id = u.property_id
      WHERE l.status = 'active' AND l.end_date < v_today
    ) x
    WHERE x.org_id IS NOT NULL
    GROUP BY x.org_id
  LOOP
    PERFORM private.notify_org_staff(
      r.org_id,
      format('%s عقد انتهت مدته بلا قرار', r.cnt),
      'جدّد العقد أو سجّل الإخلاء من «التجديدات» أو «المستأجرون والعقود»: ' || r.labels
        || CASE WHEN r.cnt > 10 THEN ' …' ELSE '' END,
      'lease', 'leases', NULL);
    n := n + 1;
  END LOOP;
  INSERT INTO public.cron_job_runs (job_name, rows_affected) VALUES ('overdue-lease-decisions', n);
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notify_overdue_lease_decisions() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'overdue-lease-decisions') THEN
    -- 04:00 UTC = 07:00 Riyadh.
    PERFORM cron.schedule('overdue-lease-decisions', '0 4 * * *', 'SELECT public.notify_overdue_lease_decisions()');
  END IF;
END $$;

-- 15) Owner money RPCs sum what was actually received (M12) -----------------------------------
-- Payments are the owner's through the lease they were signed under (leases.owner_id, P2's M13),
-- like payments_read: a unit's new owner doesn't inherit the old owner's money, the old owner keeps
-- it. Expenses and contracted rent stay with the units the caller owns now.
-- owner_finance_summary: same as 20261003120000; collected = amount_paid (partials count),
-- overdue/upcoming = what is still owed; 'recent' rows carry amount_paid.
CREATE OR REPLACE FUNCTION public.owner_finance_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
  _since date := ((now() AT TIME ZONE 'Asia/Riyadh')::date - interval '12 months')::date;
  _out jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  WITH owned AS (
    SELECT u.id AS unit_id, u.unit_number, p.name AS property_name
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    WHERE COALESCE(u.owner_id, p.owner_id) = _uid
  ),
  pay AS (
    SELECT pay.id, pay.amount, pay.amount_paid, pay.due_date, pay.paid_date, pay.status,
           u.unit_number, p.name AS property_name
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    JOIN public.units u ON u.id = l.unit_id
    JOIN public.properties p ON p.id = u.property_id
    WHERE l.owner_id = _uid
  ),
  exp AS (
    -- Unit-level expenses on the caller's units, plus property-level expenses (no unit) on
    -- properties the caller owns outright.
    SELECT e.amount, e.expense_date FROM public.expenses e
    WHERE e.unit_id IN (SELECT unit_id FROM owned)
       OR (e.unit_id IS NULL AND e.property_id IN (
             SELECT id FROM public.properties WHERE owner_id = _uid))
  )
  SELECT jsonb_build_object(
    'today', _today,
    'overdue_count', (SELECT count(*) FROM pay WHERE status <> 'paid' AND due_date < _today),
    'overdue_total', (SELECT COALESCE(sum(amount - amount_paid), 0) FROM pay WHERE status <> 'paid' AND due_date < _today),
    'upcoming_30_total', (SELECT COALESCE(sum(amount - amount_paid), 0) FROM pay
                           WHERE status <> 'paid' AND due_date BETWEEN _today AND _today + 30),
    'collected_12m', (SELECT COALESCE(sum(amount_paid), 0) FROM pay
                       WHERE amount_paid > 0 AND COALESCE(paid_date, due_date) > _since),
    'expenses_12m', (SELECT COALESCE(sum(amount), 0) FROM exp WHERE expense_date > _since),
    'months', (
      SELECT jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'collected', COALESCE((
               SELECT sum(amount_paid) FROM pay
               WHERE amount_paid > 0
                 AND date_trunc('month', COALESCE(paid_date, due_date)::timestamp) = m), 0)) ORDER BY m)
      FROM generate_series(date_trunc('month', _today::timestamp) - interval '5 months',
                           date_trunc('month', _today::timestamp), interval '1 month') AS m
    ),
    'recent', COALESCE((
      SELECT jsonb_agg(r) FROM (
        SELECT id, amount, amount_paid, due_date, paid_date, status, unit_number, property_name
        FROM pay
        -- Activity up to today only: future scheduled instalments are not "recent payments".
        WHERE due_date <= _today OR amount_paid > 0
        ORDER BY COALESCE(paid_date, due_date) DESC
        LIMIT 8
      ) r
    ), '[]'::jsonb)
  ) INTO _out;

  RETURN _out;
END;
$$;

-- owner_property_returns: same as 20261016130200; collected = amount_paid on the caller's leases.
CREATE OR REPLACE FUNCTION public.owner_property_returns()
RETURNS TABLE(
  property_id uuid, property_name text, units_count bigint, annual_rent numeric,
  collected_12m numeric, expenses_12m numeric, net_12m numeric, net_pct numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH params AS (
    SELECT ((now() AT TIME ZONE 'Asia/Riyadh')::date - interval '12 months')::date AS since
  ),
  owned AS (
    SELECT u.id AS unit_id, l.annual_rent AS lease_annual_rent, p.id AS property_id,
           p.name AS property_name, (p.owner_id = auth.uid()) AS owns_property
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    LEFT JOIN LATERAL (
      SELECT annual_rent FROM public.leases
      WHERE unit_id = u.id AND status = 'active' AND owner_id = auth.uid()
      ORDER BY start_date DESC LIMIT 1
    ) l ON true
    WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ),
  per_property AS (
    SELECT o.property_id, o.property_name, bool_or(o.owns_property) AS owns_property,
           count(*) AS units_count,
           COALESCE(sum(o.lease_annual_rent), 0) AS annual_rent
    FROM owned o GROUP BY o.property_id, o.property_name
  ),
  collected AS (
    SELECT u.property_id, sum(pay.amount_paid) AS amount
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    JOIN public.units u ON u.id = l.unit_id, params
    WHERE l.owner_id = auth.uid()
      AND pay.amount_paid > 0 AND COALESCE(pay.paid_date, pay.due_date) > params.since
    GROUP BY u.property_id
  ),
  spent AS (
    SELECT x.property_id, sum(x.amount) AS amount
    FROM (
      -- Unit-level expenses on the caller's units (property_id may be empty on these rows).
      SELECT o.property_id, e.amount, e.expense_date
      FROM public.expenses e JOIN owned o ON o.unit_id = e.unit_id
      UNION ALL
      -- Property-level expenses, only on properties the caller owns outright.
      SELECT pp.property_id, e.amount, e.expense_date
      FROM per_property pp
      JOIN public.expenses e ON e.property_id = pp.property_id AND e.unit_id IS NULL
      WHERE pp.owns_property
    ) x, params
    WHERE x.expense_date > params.since
    GROUP BY x.property_id
  )
  SELECT pp.property_id, pp.property_name, pp.units_count, pp.annual_rent,
         COALESCE(c.amount, 0), COALESCE(s.amount, 0),
         COALESCE(c.amount, 0) - COALESCE(s.amount, 0),
         CASE WHEN pp.annual_rent = 0 THEN 0
              ELSE round(100.0 * (COALESCE(c.amount, 0) - COALESCE(s.amount, 0)) / pp.annual_rent, 1)
         END
  FROM per_property pp
  LEFT JOIN collected c ON c.property_id = pp.property_id
  LEFT JOIN spent s ON s.property_id = pp.property_id
  ORDER BY 7 DESC
$$;

-- owner_cashflow_forecast: same as 20261008120000; paid = amount_paid, the caller's leases.
CREATE OR REPLACE FUNCTION public.owner_cashflow_forecast()
RETURNS TABLE(month text, due numeric, paid numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d),
  pay AS (
    SELECT pay.amount, pay.amount_paid, pay.due_date
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    WHERE auth.uid() IS NOT NULL AND l.owner_id = auth.uid()
  )
  SELECT to_char(m, 'YYYY-MM'),
         COALESCE(sum(pay.amount), 0),
         COALESCE(sum(pay.amount_paid), 0)
  FROM generate_series(
         date_trunc('month', (SELECT d FROM today)::timestamp),
         date_trunc('month', (SELECT d FROM today)::timestamp) + interval '5 months',
         interval '1 month') AS m
  LEFT JOIN pay ON date_trunc('month', pay.due_date::timestamp) = m
  GROUP BY m ORDER BY m
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.owner_finance_summary()', 'public.owner_property_returns()',
    'public.owner_cashflow_forecast()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- owner_renewals: same as 20261008120000, on the caller's leases (leases.owner_id).
CREATE OR REPLACE FUNCTION public.owner_renewals()
RETURNS TABLE(
  lease_id uuid, owner_decision text, owner_proposed_rent numeric, owner_note text,
  owner_status text, owner_decided_at timestamptz, tenant_decision text, tenant_decided_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, d.decision, d.proposed_rent, d.note, d.status, d.created_at, r.decision, r.created_at
  FROM public.leases l
  LEFT JOIN LATERAL (
    SELECT decision, proposed_rent, note, status, created_at FROM public.owner_renewal_decisions
    WHERE lease_id = l.id AND status <> 'superseded' ORDER BY created_at DESC LIMIT 1
  ) d ON true
  LEFT JOIN LATERAL (
    SELECT decision, created_at FROM public.renewal_requests
    WHERE lease_id = l.id ORDER BY created_at DESC LIMIT 1
  ) r ON true
  WHERE auth.uid() IS NOT NULL AND l.status = 'active'
    AND l.owner_id = auth.uid()
    AND (d.decision IS NOT NULL OR r.decision IS NOT NULL)
$$;

-- owner_units: same as 20261003120000; the active lease shown is one signed under the caller.
CREATE OR REPLACE FUNCTION public.owner_units()
RETURNS TABLE(
  unit_id uuid, unit_number text, unit_type text, status text, annual_rent numeric,
  property_id uuid, property_name text, city text, district text,
  lease_id uuid, lease_end_date date, lease_annual_rent numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.unit_number, u.unit_type, u.status, u.annual_rent,
         p.id, p.name, p.city, COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         l.id, l.end_date, l.annual_rent
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  LEFT JOIN LATERAL (
    SELECT id, end_date, annual_rent FROM public.leases
    WHERE unit_id = u.id AND status = 'active' AND owner_id = auth.uid()
    ORDER BY start_date DESC LIMIT 1
  ) l ON true
  WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ORDER BY p.created_at, p.name, u.unit_number
$$;

-- notify_owner_tenant_renewal: same as 20261008120000; the lease's owner hears the tenant's decision.
CREATE OR REPLACE FUNCTION private.notify_owner_tenant_renewal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _unit_number text;
  _owner uuid;
BEGIN
  SELECT l.owner_id, u.unit_number INTO _owner, _unit_number
  FROM public.leases l JOIN public.units u ON u.id = l.unit_id WHERE l.id = NEW.lease_id;
  IF _owner IS NULL THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  VALUES (
    _owner, private.org_of_lease(NEW.lease_id),
    CASE WHEN NEW.decision = 'renew' THEN 'مستأجر وحدة ' || _unit_number || ' يرغب بالتجديد'
         ELSE 'مستأجر وحدة ' || _unit_number || ' لا يرغب بالتجديد' END,
    'حدّد قرارك في التجديد من لوحة المالك ليصل للمكتب',
    'lease', 'system', 'leases', NEW.lease_id
  );
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private.notify_owner_tenant_renewal() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.owner_renewals()', 'public.owner_units()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;

-- 16) Report: units that already carry more than one active lease ------------------------------
-- The trigger above blocks new duplicates; existing ones are listed here for the office to end
-- the stale lease (end_lease) instead of failing the migration.
DO $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    SELECT l.unit_id, count(*) AS cnt, string_agg(l.id::text, ', ' ORDER BY l.start_date) AS ids
    FROM public.leases l WHERE l.status = 'active'
    GROUP BY l.unit_id HAVING count(*) > 1
  LOOP
    n := n + 1;
    RAISE WARNING 'unit % has % active leases: %', r.unit_id, r.cnt, r.ids;
  END LOOP;
  IF n > 0 THEN
    RAISE WARNING '% unit(s) with more than one active lease — end the stale lease(s) with end_lease()', n;
  END IF;
END $$;
