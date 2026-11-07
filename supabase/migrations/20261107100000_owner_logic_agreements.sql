-- Owner-logic review 2026-11-07 (qa-out/LOGIC-REVIEW.md), package P1 — management agreements.
-- Findings H1, H2, H4 (database side), M1, M2, M3, L12, L13, L14, L15, L16b. Forward-only.
--
-- 1. One rule for "is this agreement in force" (private.agreement_live): signed, Riyadh today between
--    start_date and end_date, and any termination notice not yet served. Every per-unit check (view,
--    permissions, maintenance cap, the unit's agreement office) and every conflict check uses it.
-- 2. An agreement covers a unit only while the unit still belongs to the agreement's owner (M2) and no
--    office registered the unit's property (H4: such a unit's office is the property's office).
-- 3. New status 'ended', set by a nightly job once an agreement's term has run out; the units leave
--    the website and stop automatic price cuts; owner and office are notified.
-- 4. The owner can withdraw a pending request (owner_cancel_agreement_request).
-- 5. Acceptance locks the units, re-checks them, freezes the maintenance cap and the permissions/units
--    in accepted_snapshot, and cancels every other pending request on those units.
-- 6. Unlinking an owner from an office no longer leaves rows that can never be edited again (M3).
--
-- Effect on existing rows: nothing is rewritten except that signed agreements with no maintenance cap
-- get the office's current threshold frozen into them (section 7). Agreements whose end date or notice
-- period has already passed stop granting access as soon as this ships (they already did for the
-- notice period) and become 'ended' — with notifications — on the job's first nightly run.

-- ── 1. Statuses ──────────────────────────────────────────────────────────────────────────────────
-- The inline CHECKs got generated names; drop whichever check lists the statuses, then add ours.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.management_agreements'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%office_modified%'
  LOOP
    EXECUTE format('ALTER TABLE public.management_agreements DROP CONSTRAINT %I', c.conname);
  END LOOP;
  FOR c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.agreement_change_requests'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%approved%'
  LOOP
    EXECUTE format('ALTER TABLE public.agreement_change_requests DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE public.management_agreements ADD CONSTRAINT management_agreements_status_check
  CHECK (status IN ('sent', 'office_modified', 'active', 'rejected', 'cancelled', 'ended'));
-- 'cancelled': the owner unticked the permission before the office answered, or the agreement ended.
ALTER TABLE public.agreement_change_requests ADD CONSTRAINT agreement_change_requests_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- ── 2. Liveness ──────────────────────────────────────────────────────────────────────────────────
-- In force today (product decision 1). Shared contract: other packages call this.
CREATE OR REPLACE FUNCTION private.agreement_live(_agreement_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = _agreement_id
      AND a.status = 'active'
      AND (now() AT TIME ZONE 'Asia/Riyadh')::date >= a.start_date
      AND (a.end_date IS NULL OR (now() AT TIME ZONE 'Asia/Riyadh')::date <= a.end_date)
      AND (a.termination_requested_at IS NULL
           OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  )
$$;
REVOKE ALL ON FUNCTION private.agreement_live(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.agreement_live(uuid) TO authenticated, service_role;

-- Signed and not run out: in force today or yet to start. A unit held this way can't be promised to
-- another office, can't be deleted, and its owner can't be unlinked. Not holding while still 'active'
-- means the term is over — the nightly job sets those to 'ended'.
CREATE OR REPLACE FUNCTION private.agreement_holds(_agreement_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = _agreement_id
      AND a.status = 'active'
      AND (a.end_date IS NULL OR (now() AT TIME ZONE 'Asia/Riyadh')::date <= a.end_date)
      AND (a.termination_requested_at IS NULL
           OR now() < a.termination_requested_at + make_interval(days => a.notice_period_days))
  )
$$;
REVOKE ALL ON FUNCTION private.agreement_holds(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.agreement_holds(uuid) TO authenticated, service_role;

-- The agreements in force on a unit: live, the unit still belongs to the agreement's owner (M2), and
-- the unit's property isn't registered by an office (H4: then that office is the unit's office).
CREATE OR REPLACE FUNCTION private.unit_live_agreement_ids(_unit_id uuid) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id
  FROM public.agreement_units au
  JOIN public.management_agreements a ON a.id = au.agreement_id
  JOIN public.units u ON u.id = au.unit_id
  JOIN public.properties p ON p.id = u.property_id
  WHERE au.unit_id = _unit_id
    AND a.status = 'active'
    AND p.org_id IS NULL
    AND a.owner_id = COALESCE(u.owner_id, p.owner_id)
    AND private.agreement_live(a.id)
$$;
REVOKE ALL ON FUNCTION private.unit_live_agreement_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.unit_live_agreement_ids(uuid) TO authenticated, service_role;

-- First of these units already held by another agreement of its current owner (live or yet to start).
CREATE OR REPLACE FUNCTION private.agreement_conflict_unit(_unit_ids uuid[], _except uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT au.unit_id
  FROM public.agreement_units au
  JOIN public.management_agreements a ON a.id = au.agreement_id
  JOIN public.units u ON u.id = au.unit_id
  JOIN public.properties p ON p.id = u.property_id
  WHERE au.unit_id = ANY(_unit_ids)
    AND au.agreement_id IS DISTINCT FROM _except
    AND a.owner_id = COALESCE(u.owner_id, p.owner_id)
    AND private.agreement_holds(a.id)
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION private.agreement_conflict_unit(uuid[], uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.agreement_conflict_unit(uuid[], uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.agreement_active(_unit_id uuid, _org_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.org_id = _org_id AND a.id IN (SELECT private.unit_live_agreement_ids(_unit_id))
  )
$$;

-- "view" is implied by any agreement in force; every other permission needs its row.
CREATE OR REPLACE FUNCTION private.agreement_permission(_unit_id uuid, _org_id uuid, _perm text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE
    WHEN _perm = 'view' THEN private.agreement_active(_unit_id, _org_id)
    ELSE EXISTS (
      SELECT 1
      FROM public.management_agreements a
      JOIN public.agreement_permissions ap ON ap.agreement_id = a.id
      WHERE a.org_id = _org_id
        AND ap.permission = _perm
        AND a.id IN (SELECT private.unit_live_agreement_ids(_unit_id))
    )
  END
$$;

CREATE OR REPLACE FUNCTION public.effective_maintenance_cap(_unit_id uuid, _org_id uuid)
RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT a.maintenance_cap
     FROM public.management_agreements a
     WHERE a.org_id = _org_id
       AND a.maintenance_cap IS NOT NULL
       AND a.id IN (SELECT private.unit_live_agreement_ids(_unit_id))
     ORDER BY a.created_at DESC
     LIMIT 1),
    (SELECT o.owner_approval_threshold FROM public.org_settings o WHERE o.id = _org_id)
  )
$$;

-- Shared contract, signature unchanged: the office of the agreement in force on the unit, or NULL.
CREATE OR REPLACE FUNCTION private.unit_agreement_org(_unit_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.org_id
  FROM public.management_agreements a
  WHERE a.id IN (SELECT private.unit_live_agreement_ids(_unit_id))
  ORDER BY a.created_at DESC
  LIMIT 1
$$;

-- ── 3. Shared helpers for the agreement RPCs ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.agreement_permission_label(_perm text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _perm
    WHEN 'leasing' THEN 'التأجير وإدارة العقود'
    WHEN 'pricing' THEN 'تسعير الوحدات'
    WHEN 'ejar' THEN 'تسجيل العقد في إيجار'
    WHEN 'collection' THEN 'التحصيل'
    WHEN 'maintenance' THEN 'الصيانة'
    WHEN 'tenant_comms' THEN 'التواصل مع المستأجر'
    WHEN 'renewal_eviction' THEN 'التجديد والإخلاء'
    WHEN 'sale' THEN 'البيع'
    ELSE _perm
  END
$$;

-- The terms both sides may propose, with Arabic messages instead of the table's CHECK errors.
CREATE OR REPLACE FUNCTION private.check_agreement_terms(
  _commission_type text, _commission_value numeric, _notice_period_days integer,
  _maintenance_cap numeric, _permissions text[]
) RETURNS void LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF _commission_type NOT IN ('percent', 'fixed') THEN
    RAISE EXCEPTION 'نوع العمولة غير معروف' USING ERRCODE = '22023';
  END IF;
  IF _commission_value IS NULL OR _commission_value < 0 THEN
    RAISE EXCEPTION 'أدخل قيمة عمولة صحيحة' USING ERRCODE = '22023';
  END IF;
  IF _commission_type = 'percent' AND _commission_value > 100 THEN
    RAISE EXCEPTION 'نسبة العمولة لا تتجاوز ١٠٠٪' USING ERRCODE = '22023';
  END IF;
  IF _notice_period_days IS NOT NULL AND _notice_period_days < 0 THEN
    RAISE EXCEPTION 'فترة الإشعار يجب أن تكون رقمًا صحيحًا' USING ERRCODE = '22023';
  END IF;
  IF _maintenance_cap IS NOT NULL AND _maintenance_cap < 0 THEN
    RAISE EXCEPTION 'سقف الصيانة لا يكون سالبًا' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(COALESCE(_permissions, '{}')) AS p
    WHERE p IS NULL OR p NOT IN
      ('leasing', 'pricing', 'ejar', 'collection', 'maintenance', 'tenant_comms', 'renewal_eviction', 'sale')
  ) THEN
    RAISE EXCEPTION 'إحدى الصلاحيات غير معروفة' USING ERRCODE = '22023';
  END IF;
END $$;

-- Units an office registered can't be put under an agreement (their office is the property's office).
CREATE OR REPLACE FUNCTION private.refuse_office_registered_units(_unit_ids uuid[]) RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE unit_no text; office text;
BEGIN
  SELECT u.unit_number, COALESCE(NULLIF(btrim(o.company_name), ''), 'مكتب آخر')
  INTO unit_no, office
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  LEFT JOIN public.org_settings o ON o.id = p.org_id
  WHERE u.id = ANY(_unit_ids) AND p.org_id IS NOT NULL
  LIMIT 1;
  IF unit_no IS NOT NULL THEN
    RAISE EXCEPTION 'الوحدة % يديرها % — لا يمكن ضمّها لاتفاقية إدارة', unit_no, office
      USING ERRCODE = '23505';
  END IF;
END $$;

-- Accepting (by the office, or by the owner after a counter-offer). The caller holds the row lock.
CREATE OR REPLACE FUNCTION private.activate_agreement(_agreement_id uuid, _office_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.management_agreements%ROWTYPE;
  unit_ids uuid[];
  perms text[];
  cap numeric;
  office text;
  other record;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id;
  SELECT COALESCE(array_agg(unit_id ORDER BY unit_id), '{}') INTO unit_ids
  FROM public.agreement_units WHERE agreement_id = _agreement_id;
  IF array_length(unit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'لم تعد في الطلب أي وحدة — اطلب اتفاقية جديدة' USING ERRCODE = '22023';
  END IF;

  -- Two acceptances on the same unit queue here, so the second sees the first in the checks below.
  PERFORM 1 FROM public.units WHERE id = ANY(unit_ids) ORDER BY id FOR UPDATE;

  IF a.end_date IS NOT NULL AND a.end_date < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
    RAISE EXCEPTION 'مضى تاريخ انتهاء الاتفاقية المقترحة — اطلب اتفاقية جديدة' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
    WHERE u.id = ANY(unit_ids) AND COALESCE(u.owner_id, p.owner_id) IS DISTINCT FROM a.owner_id
  ) THEN
    RAISE EXCEPTION 'تغيّر مالك إحدى الوحدات بعد الطلب — لا يمكن تفعيل الاتفاقية' USING ERRCODE = '22023';
  END IF;
  PERFORM private.refuse_office_registered_units(unit_ids);
  IF private.agreement_conflict_unit(unit_ids, _agreement_id) IS NOT NULL THEN
    RAISE EXCEPTION 'إحدى الوحدات صار لها اتفاقية سارية مع مكتب آخر' USING ERRCODE = '23505';
  END IF;

  -- The cap the owner signed for: the office's threshold today, not whatever it is set to later.
  cap := COALESCE(
    a.maintenance_cap,
    (SELECT o.owner_approval_threshold FROM public.org_settings o WHERE o.id = a.org_id),
    2000);
  SELECT COALESCE(array_agg(permission ORDER BY permission), '{}') INTO perms
  FROM public.agreement_permissions WHERE agreement_id = _agreement_id;

  UPDATE public.management_agreements SET
    status = 'active',
    maintenance_cap = cap,
    office_note = _office_note,
    accepted_snapshot = (to_jsonb(a) - 'accepted_snapshot') || jsonb_build_object(
      'status', 'active', 'maintenance_cap', cap, 'office_note', _office_note,
      'accepted_at', now(), 'permissions', to_jsonb(perms), 'unit_ids', to_jsonb(unit_ids))
  WHERE id = _agreement_id;

  -- Every other request still waiting on these units is withdrawn, and its office told why.
  SELECT COALESCE(NULLIF(btrim(company_name), ''), 'مكتب آخر') INTO office
  FROM public.org_settings WHERE id = a.org_id;
  FOR other IN
    UPDATE public.management_agreements m SET status = 'cancelled'
    WHERE m.id <> _agreement_id
      AND m.status IN ('sent', 'office_modified')
      AND EXISTS (SELECT 1 FROM public.agreement_units au
                  WHERE au.agreement_id = m.id AND au.unit_id = ANY(unit_ids))
    RETURNING m.id, m.org_id, m.owner_id
  LOOP
    PERFORM private.notify_org_staff(other.org_id, 'أُلغي طلب إدارة تلقائيًا',
      'صارت وحدات من هذا الطلب تحت إدارة مكتب آخر، فلم يعد بانتظار ردّكم.',
      'agreement', 'management_agreements', other.id);
    INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
    VALUES (other.owner_id, 'أُلغي أحد طلبات الإدارة تلقائيًا',
            'صارت وحدات هذا الطلب تحت إدارة ' || COALESCE(office, 'مكتب آخر') || '، فسُحب الطلب تلقائيًا.',
            'agreement', 'system', 'management_agreements', other.id);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.activate_agreement(uuid, text) FROM PUBLIC, anon, authenticated;

-- ── 4. Agreement RPCs ────────────────────────────────────────────────────────────────────────────
-- Newest definition: 20261017100000. Adds term validation, the office-registered refusal (H4), unit
-- locks before the checks, and the live-or-upcoming conflict rule.
CREATE OR REPLACE FUNCTION public.request_management_agreement(
  _org_id uuid, _unit_ids uuid[], _commission_type text, _commission_value numeric,
  _start_date date, _end_date date, _notice_period_days integer, _maintenance_cap numeric,
  _permissions text[], _note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE agreement_id uuid; uid uuid := auth.uid(); uid_check uuid; owner_label text; n int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF _unit_ids IS NULL OR array_length(_unit_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'اختر وحدة واحدة على الأقل' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.org_settings WHERE id = _org_id AND verified) THEN
    RAISE EXCEPTION 'المكتب غير متاح لاستقبال الطلبات' USING ERRCODE = '22023';
  END IF;
  PERFORM private.check_agreement_terms(_commission_type, _commission_value, _notice_period_days,
                                        _maintenance_cap, _permissions);
  IF _start_date IS NULL THEN
    RAISE EXCEPTION 'اختر تاريخ البدء' USING ERRCODE = '22023';
  END IF;
  IF _end_date IS NOT NULL AND _end_date <= _start_date THEN
    RAISE EXCEPTION 'تاريخ الانتهاء يجب أن يكون بعد تاريخ البدء' USING ERRCODE = '22023';
  END IF;
  IF _end_date IS NOT NULL AND _end_date < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
    RAISE EXCEPTION 'تاريخ الانتهاء مضى — اختر تاريخًا لاحقًا' USING ERRCODE = '22023';
  END IF;

  -- Concurrent requests and acceptances on the same units wait here for each other.
  PERFORM 1 FROM public.units WHERE id = ANY(_unit_ids) ORDER BY id FOR UPDATE;

  -- كل وحدة لازم تكون فعلاً مملوكة لمن يطلب — مالك الوحدة نفسها، وإلا مالك عقارها.
  SELECT u.id INTO uid_check
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = ANY(_unit_ids) AND COALESCE(u.owner_id, p.owner_id) IS DISTINCT FROM uid
  LIMIT 1;
  IF uid_check IS NOT NULL
     OR (SELECT count(*) FROM public.units WHERE id = ANY(_unit_ids))
        <> (SELECT count(DISTINCT u) FROM unnest(_unit_ids) AS u) THEN
    RAISE EXCEPTION 'إحدى الوحدات ليست مملوكة لك' USING ERRCODE = '42501';
  END IF;

  PERFORM private.refuse_office_registered_units(_unit_ids);

  -- ولا وحدة منها لها اتفاقية سارية أو موقّعة تبدأ لاحقًا (مع أي مكتب) — الطلبات المعلّقة لمكاتب أخرى مسموحة.
  IF private.agreement_conflict_unit(_unit_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'إحدى الوحدات لها اتفاقية سارية بالفعل' USING ERRCODE = '23505';
  END IF;

  -- ولا طلب ثانٍ لنفس المكتب على نفس الوحدة وهو ما زال بانتظار الرد.
  IF EXISTS (
    SELECT 1 FROM public.agreement_units au
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE au.unit_id = ANY(_unit_ids) AND a.org_id = _org_id AND a.owner_id = uid
      AND a.status IN ('sent', 'office_modified')
  ) THEN
    RAISE EXCEPTION 'لديك طلب بانتظار ردّ هذا المكتب على إحدى هذه الوحدات' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.management_agreements
    (org_id, owner_id, status, initiated_by, commission_type, commission_value,
     start_date, end_date, notice_period_days, maintenance_cap, owner_note)
  VALUES
    (_org_id, uid, 'sent', 'owner', _commission_type, _commission_value,
     _start_date, _end_date, COALESCE(_notice_period_days, 30), _maintenance_cap,
     NULLIF(btrim(_note), ''))
  RETURNING id INTO agreement_id;

  INSERT INTO public.agreement_units (agreement_id, unit_id)
  SELECT DISTINCT agreement_id, u FROM unnest(_unit_ids) AS u;

  IF _permissions IS NOT NULL THEN
    INSERT INTO public.agreement_permissions (agreement_id, permission)
    SELECT DISTINCT agreement_id, p FROM unnest(_permissions) AS p;
  END IF;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'مالك') INTO owner_label FROM public.profiles WHERE id = uid;
  n := (SELECT count(DISTINCT u) FROM unnest(_unit_ids) AS u);
  PERFORM private.notify_org_staff(
    _org_id,
    'طلب إدارة أملاك جديد',
    COALESCE(owner_label, 'مالك') || ' يطلب من مكتبك إدارة ' || n || ' وحدة — راجع الطلب واقبله أو ارفضه.',
    'agreement', 'management_agreements', agreement_id);

  RETURN agreement_id;
END $$;
REVOKE ALL ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_management_agreement(uuid, uuid[], text, numeric, date, date, integer, numeric, text[], text) TO authenticated;

-- Newest definition: 20261017100000. Office staff only (L12), counter-offers validated and able to
-- clear the cap (L14), acceptance through private.activate_agreement.
DROP FUNCTION IF EXISTS public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text);
DROP FUNCTION IF EXISTS public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text, boolean);
CREATE FUNCTION public.office_respond_agreement(
  _agreement_id uuid, _decision text, _commission_value numeric DEFAULT NULL,
  _notice_period_days integer DEFAULT NULL, _maintenance_cap numeric DEFAULT NULL,
  _permissions text[] DEFAULT NULL, _note text DEFAULT NULL, _clear_maintenance_cap boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; note text := NULLIF(btrim(_note), '');
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الاتفاقية غير موجودة' USING ERRCODE = '02000'; END IF;
  IF NOT public.is_staff(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.org_members m
                    WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member') THEN
    RAISE EXCEPTION 'هذا الطلب ليس لمكتبك' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('sent') THEN
    RAISE EXCEPTION 'الطلب ليس بانتظار ردّ المكتب' USING ERRCODE = '22023';
  END IF;

  IF _decision = 'reject' THEN
    UPDATE public.management_agreements SET status = 'rejected', office_note = note
    WHERE id = _agreement_id;
    RETURN;
  END IF;

  IF _decision = 'counter' THEN
    PERFORM private.check_agreement_terms(
      a.commission_type, COALESCE(_commission_value, a.commission_value),
      _notice_period_days, _maintenance_cap, _permissions);
    UPDATE public.management_agreements SET
      status = 'office_modified',
      commission_value = COALESCE(_commission_value, commission_value),
      notice_period_days = COALESCE(_notice_period_days, notice_period_days),
      maintenance_cap = CASE WHEN _clear_maintenance_cap THEN NULL
                             ELSE COALESCE(_maintenance_cap, maintenance_cap) END,
      office_note = note
    WHERE id = _agreement_id;
    IF _permissions IS NOT NULL THEN
      DELETE FROM public.agreement_permissions WHERE agreement_id = _agreement_id;
      INSERT INTO public.agreement_permissions (agreement_id, permission)
      SELECT DISTINCT _agreement_id, p FROM unnest(_permissions) AS p;
    END IF;
    RETURN;
  END IF;

  IF _decision = 'accept' THEN
    PERFORM private.activate_agreement(_agreement_id, note);
    RETURN;
  END IF;

  RAISE EXCEPTION 'قرار غير معروف' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_respond_agreement(uuid, text, numeric, integer, numeric, text[], text, boolean) TO authenticated;

-- Newest definition: 20260924131550. Acceptance through private.activate_agreement.
CREATE OR REPLACE FUNCTION public.owner_decide_countered_agreement(_agreement_id uuid, _decision text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE;
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
    PERFORM private.activate_agreement(_agreement_id, a.office_note);
    RETURN;
  END IF;

  RAISE EXCEPTION 'قرار غير معروف' USING ERRCODE = '22023';
END $$;
REVOKE ALL ON FUNCTION public.owner_decide_countered_agreement(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_decide_countered_agreement(uuid, text) TO authenticated;

-- M1: the owner withdraws a request the office hasn't settled yet.
CREATE OR REPLACE FUNCTION public.owner_cancel_agreement_request(_agreement_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; owner_label text;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL OR a.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'الطلب غير موجود أو ليس لك' USING ERRCODE = '42501';
  END IF;
  IF a.status NOT IN ('sent', 'office_modified') THEN
    RAISE EXCEPTION 'لا يمكن سحب طلب بعد البتّ فيه' USING ERRCODE = '22023';
  END IF;

  UPDATE public.management_agreements SET status = 'cancelled' WHERE id = _agreement_id;

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'المالك') INTO owner_label
  FROM public.profiles WHERE id = a.owner_id;
  PERFORM private.notify_org_staff(a.org_id, COALESCE(owner_label, 'المالك') || ' سحب طلب الإدارة',
    'أُلغي الطلب ولم يعد بانتظار ردّكم.', 'agreement', 'management_agreements', a.id);
END $$;
REVOKE ALL ON FUNCTION public.owner_cancel_agreement_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_cancel_agreement_request(uuid) TO authenticated;

-- Newest definition: 20260924131550. Pending widen requests follow the owner's latest choice and
-- both sides are told (L13); only an agreement that still holds can be changed.
CREATE OR REPLACE FUNCTION public.update_agreement_permissions(_agreement_id uuid, _permissions text[])
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  a public.management_agreements%ROWTYPE;
  wanted text[] := COALESCE(_permissions, '{}');
  current_perms text[]; pending_perms text[]; added text[]; removed text[];
  owner_label text;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL OR a.owner_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'الاتفاقية غير موجودة أو ليست لك' USING ERRCODE = '42501';
  END IF;
  IF NOT private.agreement_holds(a.id) THEN
    RAISE EXCEPTION 'الاتفاقية ليست سارية' USING ERRCODE = '22023';
  END IF;
  -- Only the permissions are checked here: older agreements may carry terms the checks now refuse.
  PERFORM private.check_agreement_terms('fixed', 0, NULL, NULL, wanted);

  SELECT COALESCE(array_agg(permission), '{}') INTO current_perms
  FROM public.agreement_permissions WHERE agreement_id = _agreement_id;

  -- Widen requests for permissions the owner no longer ticks are withdrawn.
  UPDATE public.agreement_change_requests SET status = 'cancelled', decided_at = now()
  WHERE agreement_id = _agreement_id AND kind = 'permission_widen' AND status = 'pending'
    AND NOT ((payload ->> 'permission') = ANY(wanted));
  SELECT COALESCE(array_agg(payload ->> 'permission'), '{}') INTO pending_perms
  FROM public.agreement_change_requests
  WHERE agreement_id = _agreement_id AND kind = 'permission_widen' AND status = 'pending';

  SELECT COALESCE(array_agg(p), '{}') INTO removed
  FROM unnest(current_perms) AS p WHERE NOT (p = ANY(wanted));
  SELECT COALESCE(array_agg(DISTINCT p), '{}') INTO added
  FROM unnest(wanted) AS p WHERE NOT (p = ANY(current_perms)) AND NOT (p = ANY(pending_perms));

  SELECT COALESCE(NULLIF(btrim(full_name), ''), 'المالك') INTO owner_label
  FROM public.profiles WHERE id = a.owner_id;
  owner_label := COALESCE(owner_label, 'المالك');

  IF array_length(removed, 1) IS NOT NULL THEN
    DELETE FROM public.agreement_permissions
    WHERE agreement_id = _agreement_id AND permission = ANY(removed);
    PERFORM private.notify_org_staff(a.org_id, owner_label || ' قلّص صلاحيات الإدارة',
      'سُحبت: ' || (SELECT string_agg(private.agreement_permission_label(p), '، ') FROM unnest(removed) AS p) || '.',
      'agreement', 'management_agreements', a.id);
  END IF;

  IF array_length(added, 1) IS NOT NULL THEN
    INSERT INTO public.agreement_change_requests (agreement_id, kind, payload, requested_by)
    SELECT _agreement_id, 'permission_widen', jsonb_build_object('permission', p), auth.uid()
    FROM unnest(added) AS p;
    PERFORM private.notify_org_staff(a.org_id, owner_label || ' يطلب توسيع صلاحيات الإدارة',
      'المطلوب: ' || (SELECT string_agg(private.agreement_permission_label(p), '، ') FROM unnest(added) AS p)
        || ' — وافق أو ارفض من «اتفاقيات الإدارة».',
      'agreement', 'management_agreements', a.id);
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.update_agreement_permissions(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_agreement_permissions(uuid, text[]) TO authenticated;

-- Newest definition: 20260924131550. Office staff only (L12), only while the agreement holds, and
-- the owner hears the answer (L13).
CREATE OR REPLACE FUNCTION public.office_decide_change_request(_request_id uuid, _decision text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.agreement_change_requests%ROWTYPE; a public.management_agreements%ROWTYPE;
  office text; perm_label text;
BEGIN
  SELECT * INTO r FROM public.agreement_change_requests WHERE id = _request_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'الطلب غير موجود' USING ERRCODE = '02000'; END IF;
  SELECT * INTO a FROM public.management_agreements WHERE id = r.agreement_id;
  IF NOT public.is_staff(auth.uid())
     OR NOT EXISTS (SELECT 1 FROM public.org_members m
                    WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member') THEN
    RAISE EXCEPTION 'هذا الطلب ليس لمكتبك' USING ERRCODE = '42501';
  END IF;
  IF r.status <> 'pending' THEN
    RAISE EXCEPTION 'تمت معالجة هذا الطلب مسبقًا' USING ERRCODE = '22023';
  END IF;
  IF _decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'قرار غير معروف' USING ERRCODE = '22023';
  END IF;
  IF _decision = 'approve' AND NOT private.agreement_holds(a.id) THEN
    RAISE EXCEPTION 'الاتفاقية لم تعد سارية' USING ERRCODE = '22023';
  END IF;

  UPDATE public.agreement_change_requests
  SET status = CASE WHEN _decision = 'approve' THEN 'approved' ELSE 'rejected' END, decided_at = now()
  WHERE id = _request_id;

  IF _decision = 'approve' AND r.kind = 'permission_widen' THEN
    INSERT INTO public.agreement_permissions (agreement_id, permission)
    VALUES (r.agreement_id, r.payload ->> 'permission')
    ON CONFLICT DO NOTHING;
  END IF;

  SELECT COALESCE(NULLIF(btrim(company_name), ''), 'المكتب') INTO office
  FROM public.org_settings WHERE id = a.org_id;
  office := COALESCE(office, 'المكتب');
  perm_label := private.agreement_permission_label(r.payload ->> 'permission');
  INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
  VALUES (a.owner_id,
          CASE WHEN _decision = 'approve' THEN 'وافق ' || office || ' على توسيع الصلاحية'
               ELSE 'اعتذر ' || office || ' عن توسيع الصلاحية' END,
          CASE WHEN _decision = 'approve' THEN 'صارت «' || perm_label || '» ضمن صلاحيات الاتفاقية.'
               ELSE 'بقيت «' || perm_label || '» خارج صلاحيات الاتفاقية.' END,
          'agreement', 'system', 'management_agreements', a.id);
END $$;
REVOKE ALL ON FUNCTION public.office_decide_change_request(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_decide_change_request(uuid, text) TO authenticated;

-- Newest definition: 20260924131550. Office staff only (L12); nothing to terminate once it ran out.
CREATE OR REPLACE FUNCTION public.request_agreement_termination(_agreement_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a public.management_agreements%ROWTYPE; requested_by_party text;
BEGIN
  SELECT * INTO a FROM public.management_agreements WHERE id = _agreement_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'الاتفاقية غير موجودة' USING ERRCODE = '02000'; END IF;

  IF a.owner_id = auth.uid() THEN
    requested_by_party := 'owner';
  ELSIF public.is_staff(auth.uid())
        AND EXISTS (SELECT 1 FROM public.org_members m
                    WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member') THEN
    requested_by_party := 'office';
  ELSE
    RAISE EXCEPTION 'ما تقدر تنهي هذي الاتفاقية' USING ERRCODE = '42501';
  END IF;

  IF NOT private.agreement_holds(a.id) THEN
    RAISE EXCEPTION 'الاتفاقية ليست سارية' USING ERRCODE = '22023';
  END IF;

  UPDATE public.management_agreements
  SET termination_requested_by = requested_by_party, termination_requested_at = now()
  WHERE id = _agreement_id AND termination_requested_at IS NULL;
END $$;
REVOKE ALL ON FUNCTION public.request_agreement_termination(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_agreement_termination(uuid) TO authenticated;

-- Newest definition: 20261017100000. Adds 'ended' and `live`; full specs only while the request is
-- pending or the agreement is in force on that unit, deed numbers only in force (H2).
DROP FUNCTION IF EXISTS public.office_agreement_requests();
CREATE FUNCTION public.office_agreement_requests()
RETURNS TABLE(id uuid, owner_name text, owner_email text, status text, commission_type text,
  commission_value numeric, start_date date, end_date date, notice_period_days integer,
  maintenance_cap numeric, termination_requested_at timestamptz, termination_requested_by text,
  units_count bigint, units jsonb, permissions text[], created_at timestamptz,
  owner_note text, office_note text, live boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := public.my_org_id();
BEGIN
  -- أي موظف من المكتب، لا مدير حصرًا — يطابق صلاحية البتّ الفعلية في office_respond_agreement().
  IF org IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه الشاشة لموظفي المكتب' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    a.id, pr.full_name, u.email::text, a.status, a.commission_type, a.commission_value,
    a.start_date, a.end_date, a.notice_period_days, a.maintenance_cap,
    a.termination_requested_at, a.termination_requested_by,
    (SELECT count(*) FROM public.agreement_units au WHERE au.agreement_id = a.id),
    (SELECT coalesce(jsonb_agg(
        CASE WHEN a.status IN ('sent', 'office_modified') OR cov.covered THEN jsonb_build_object(
          'unit_id', un.id, 'unit_number', un.unit_number, 'unit_name', un.unit_name,
          'unit_type', un.unit_type, 'property_name', p.name, 'property_structure', p.structure,
          'city', p.city, 'district', COALESCE(NULLIF(un.district, ''), p.district),
          'floor_no', un.floor_no, 'area', un.area, 'rooms', un.rooms, 'halls', un.halls,
          'bathrooms', un.bathrooms, 'furnishing', un.furnishing, 'furniture', un.furniture,
          'annual_rent', un.annual_rent, 'listing_purpose', un.listing_purpose,
          'sale_price', un.sale_price, 'status', un.status,
          'deed_number', CASE WHEN cov.covered THEN un.deed_number END)
        -- Past agreements keep only which units they were about.
        ELSE jsonb_build_object(
          'unit_id', un.id, 'unit_number', un.unit_number, 'unit_name', un.unit_name,
          'unit_type', un.unit_type, 'property_name', p.name, 'property_structure', p.structure)
        END ORDER BY p.name, un.unit_number), '[]'::jsonb)
     FROM public.agreement_units au
     JOIN public.units un ON un.id = au.unit_id
     JOIN public.properties p ON p.id = un.property_id
     CROSS JOIN LATERAL (
       SELECT a.id IN (SELECT private.unit_live_agreement_ids(un.id)) AS covered
     ) cov
     WHERE au.agreement_id = a.id),
    COALESCE(
      (SELECT array_agg(ap.permission) FROM public.agreement_permissions ap WHERE ap.agreement_id = a.id),
      '{}'),
    a.created_at,
    a.owner_note,
    a.office_note,
    private.agreement_live(a.id)
  FROM public.management_agreements a
  JOIN auth.users u ON u.id = a.owner_id
  LEFT JOIN public.profiles pr ON pr.id = a.owner_id
  -- 'cancelled' stays out: the owner withdrew it, and the office was notified.
  WHERE a.org_id = org AND a.status IN ('sent', 'office_modified', 'active', 'rejected', 'ended')
  ORDER BY (a.status IN ('sent', 'office_modified')) DESC, private.agreement_holds(a.id) DESC,
           a.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.office_agreement_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_agreement_requests() TO authenticated;

-- Newest definition: 20261003120000. An agreement office counts only for units it manages today (H2).
CREATE OR REPLACE FUNCTION public.owner_offices()
RETURNS TABLE(
  id uuid, company_name text, fal_license_no text, office_phone text,
  city text, district text, address text, logo_url text, units_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH mine AS (
    SELECT u.id AS unit_id, p.org_id
    FROM public.units u JOIN public.properties p ON p.id = u.property_id
    WHERE auth.uid() IS NOT NULL AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
  ), links AS (
    SELECT m.org_id, m.unit_id FROM mine m WHERE m.org_id IS NOT NULL
    UNION
    SELECT private.unit_agreement_org(m.unit_id), m.unit_id FROM mine m WHERE m.org_id IS NULL
  )
  SELECT o.id, o.company_name, o.fal_license_no, o.office_phone, o.city, o.district, o.address,
         o.logo_url, count(DISTINCT l.unit_id)
  FROM links l JOIN public.org_settings o ON o.id = l.org_id
  GROUP BY o.id
  ORDER BY count(DISTINCT l.unit_id) DESC, o.company_name
$$;

-- ── 5. Deleting an owner's property: only a pending request or an agreement that holds blocks it ──
-- Blocks deleting the unit (H2): a request still waiting, or a signed agreement that hasn't run out,
-- of the unit's current owner. Also meant for the unit branch of private.guard_owner_unit_write.
CREATE OR REPLACE FUNCTION private.unit_agreement_blocks_delete(_unit_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.agreement_units au
    JOIN public.management_agreements a ON a.id = au.agreement_id
    WHERE au.unit_id = _unit_id
      AND a.owner_id = private.unit_owner(_unit_id)
      AND (a.status IN ('sent', 'office_modified') OR private.agreement_holds(a.id))
  )
$$;
REVOKE ALL ON FUNCTION private.unit_agreement_blocks_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.unit_agreement_blocks_delete(uuid) TO authenticated, service_role;

-- Newest definition: 20261017100000; only the agreement check changes.
CREATE OR REPLACE FUNCTION private.guard_owner_property_delete()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) OR OLD.org_id IS NOT NULL
     OR OLD.owner_id IS DISTINCT FROM auth.uid() THEN
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.units u JOIN public.leases l ON l.unit_id = u.id WHERE u.property_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'لا يمكن حذف عقار لوحداته عقود إيجار مسجّلة' USING ERRCODE = '23503';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.property_id = OLD.id AND private.unit_agreement_blocks_delete(u.id)
  ) THEN
    RAISE EXCEPTION 'إحدى وحدات العقار مشمولة باتفاقية إدارة سارية أو طلب بانتظار الرد — اسحب الطلب أو أنهِ الاتفاقية أولًا'
      USING ERRCODE = '23503';
  END IF;
  RETURN OLD;
END $$;

-- ── 6. Nightly: agreements whose term ran out become 'ended' ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.end_lapsed_management_agreements() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; n integer := 0; office text; owner_label text; why text;
BEGIN
  FOR a IN
    SELECT m.id, m.org_id, m.owner_id, m.end_date, m.termination_requested_at,
           NOT private.agreement_holds(m.id) AS lapsed
    FROM public.management_agreements m
    WHERE m.status = 'active'
      AND (NOT private.agreement_holds(m.id)
           -- None of its units is still the owner's own, outside an office's property (M2, H4).
           OR NOT EXISTS (
             SELECT 1 FROM public.agreement_units au
             JOIN public.units u ON u.id = au.unit_id
             JOIN public.properties p ON p.id = u.property_id
             WHERE au.agreement_id = m.id AND p.org_id IS NULL
               AND COALESCE(u.owner_id, p.owner_id) = m.owner_id))
    ORDER BY m.id
  LOOP
    BEGIN
      UPDATE public.management_agreements SET status = 'ended' WHERE id = a.id AND status = 'active';
      UPDATE public.agreement_change_requests SET status = 'cancelled', decided_at = now()
      WHERE agreement_id = a.id AND status = 'pending';

      -- Units left with no office stop being advertised and stop having their price cut.
      UPDATE public.units u SET market_listed = false, auto_price_decay = false
      FROM public.agreement_units au, public.properties p
      WHERE au.agreement_id = a.id AND u.id = au.unit_id AND p.id = u.property_id
        AND p.org_id IS NULL
        AND private.unit_agreement_org(u.id) IS NULL
        AND (u.market_listed OR u.auto_price_decay);

      SELECT COALESCE(NULLIF(btrim(company_name), ''), 'المكتب') INTO office
      FROM public.org_settings WHERE id = a.org_id;
      office := COALESCE(office, 'المكتب');
      SELECT COALESCE(NULLIF(btrim(full_name), ''), 'المالك') INTO owner_label
      FROM public.profiles WHERE id = a.owner_id;
      owner_label := COALESCE(owner_label, 'المالك');
      why := CASE
        WHEN NOT a.lapsed THEN 'لم تعد وحداتها ضمن أملاك المالك الخاصة'
        WHEN a.end_date IS NOT NULL AND a.end_date < (now() AT TIME ZONE 'Asia/Riyadh')::date
          THEN 'بلغت تاريخ انتهائها'
        ELSE 'انقضت فترة الإشعار بعد طلب الإنهاء'
      END;

      INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
      VALUES (a.owner_id, 'انتهت اتفاقية الإدارة مع ' || office,
              why || '. لم يعد المكتب يدير وحداتها، وأُوقف نشرها في الموقع وتخفيض سعرها التلقائي.',
              'agreement', 'system', 'management_agreements', a.id);
      PERFORM private.notify_org_staff(a.org_id, 'انتهت اتفاقية إدارة أملاك ' || owner_label,
        why || '. انتهى وصولكم لوحداتها وأُوقف نشرها في الموقع.',
        'agreement', 'management_agreements', a.id);
      n := n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'end_lapsed_management_agreements: agreement % skipped: %', a.id, SQLERRM;
    END;
  END LOOP;
  INSERT INTO public.cron_job_runs (job_name, rows_affected) VALUES ('end-lapsed-agreements', n);
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.end_lapsed_management_agreements() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'end-lapsed-agreements') THEN
    -- 00:05 Riyadh, right after an end date passes.
    PERFORM cron.schedule('end-lapsed-agreements', '5 21 * * *',
                          'SELECT public.end_lapsed_management_agreements()');
  END IF;
END $$;

-- ── 7. Freeze the cap of agreements signed before this migration (L14) ───────────────────────────
-- Their effective cap today is the office's threshold (or the app default 2000); keep it as signed.
UPDATE public.management_agreements a
SET maintenance_cap = COALESCE(
  (SELECT o.owner_approval_threshold FROM public.org_settings o WHERE o.id = a.org_id), 2000)
WHERE a.status = 'active' AND a.maintenance_cap IS NULL;

-- ── 8. Price decay: per-unit failures don't abort the run; agreement units need pricing in force ──
-- Newest definition: 20260927210856.
CREATE OR REPLACE FUNCTION public.decay_vacant_unit_prices() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  new_price numeric;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT u.id, u.listing_purpose, u.annual_rent, u.sale_price, u.price_floor
    FROM public.units u
    JOIN public.properties p ON p.id = u.property_id
    WHERE u.status = 'vacant' AND u.market_listed AND u.auto_price_decay
      AND u.price_floor IS NOT NULL
      AND u.vacant_since IS NOT NULL AND u.vacant_since <= now() - interval '14 days'
      AND (u.price_decayed_at IS NULL OR u.price_decayed_at <= now() - interval '7 days')
      -- An owner's own unit is priced by its agreement office only while it may set prices.
      AND (p.org_id IS NOT NULL
           OR COALESCE(u.owner_id, p.owner_id) IS NULL
           OR private.agreement_permission(u.id, private.unit_agreement_org(u.id), 'pricing'))
  LOOP
    BEGIN
      IF r.listing_purpose = 'sale' THEN
        new_price := greatest(r.price_floor, round(r.sale_price * 0.98));
        IF new_price < r.sale_price THEN
          UPDATE public.units SET sale_price = new_price, price_decayed_at = now() WHERE id = r.id;
          PERFORM public.notify_unit(r.id, 'خُفِّض سعر وحدتك تلقائيًا',
            'انخفض سعر البيع إلى ' || to_char(new_price, 'FM999999999') || ' ريال لطول فترة العرض بلا اهتمام كافٍ.', 'unit');
          n := n + 1;
        END IF;
      ELSE
        new_price := greatest(r.price_floor, round(r.annual_rent * 0.98));
        IF new_price < r.annual_rent THEN
          UPDATE public.units SET annual_rent = new_price, price_decayed_at = now() WHERE id = r.id;
          PERFORM public.notify_unit(r.id, 'خُفِّض إيجار وحدتك تلقائيًا',
            'انخفض الإيجار السنوي إلى ' || to_char(new_price, 'FM999999999') || ' ريال لطول فترة العرض بلا اهتمام كافٍ.', 'unit');
          n := n + 1;
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'decay_vacant_unit_prices: unit % skipped: %', r.id, SQLERRM;
    END;
  END LOOP;
  INSERT INTO public.cron_job_runs (job_name, rows_affected) VALUES ('vacant-price-decay', n);
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.decay_vacant_unit_prices() FROM PUBLIC, anon, authenticated;

-- ── 9. Office people (M3, L15, L16b) ─────────────────────────────────────────────────────────────
-- Newest definition: 20260922110000. Judge only a new link — a new person on the row, or the row
-- moving to another office. Edits that keep both (a lease syncing the unit's status, the price-decay
-- job, the owner's own edits) no longer fail because the person was unlinked later.
CREATE OR REPLACE FUNCTION private.guard_person_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  j jsonb := to_jsonb(NEW);
  person_col text := CASE TG_TABLE_NAME WHEN 'tenants' THEN 'user_id' ELSE 'owner_id' END;
  office_col text := CASE TG_TABLE_NAME WHEN 'units' THEN 'property_id' ELSE 'org_id' END;
  uid uuid; org uuid;
BEGIN
  uid := private.try_uuid(j ->> person_col);
  IF uid IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(OLD) ->> person_col) IS NOT DISTINCT FROM (j ->> person_col)
       AND (to_jsonb(OLD) ->> office_col) IS NOT DISTINCT FROM (j ->> office_col) THEN
      RETURN NEW;
    END IF;
  END IF;
  org := CASE TG_TABLE_NAME
    WHEN 'units' THEN private.org_of_property(private.try_uuid(j ->> 'property_id'))
    ELSE private.try_uuid(j ->> 'org_id') END;
  IF NOT private.may_link(uid, org) THEN
    RAISE EXCEPTION 'هذا الحساب ليس من أشخاص مكتبك — ادعُه أولًا من شاشة «فريق المكتب»'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION private.guard_person_link() FROM PUBLIC;

-- Newest definition: 20260924000346. An owner who still owns rows in the office, or has an agreement
-- with it that holds, and a tenant with an active lease in it, can't be unlinked: the office would keep
-- their data with no link to edit it, and the tenant would lose access mid-lease.
CREATE OR REPLACE FUNCTION public.office_unlink_client(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE org uuid := public.my_org();
BEGIN
  IF NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501'; END IF;
  IF EXISTS (SELECT 1 FROM public.properties p WHERE p.org_id = org AND p.owner_id = _user)
     OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
                WHERE p.org_id = org AND u.owner_id = _user) THEN
    RAISE EXCEPTION 'لا يمكن إلغاء ربط مالك له عقارات أو وحدات في مكتبك — انقل ملكيتها لمالك آخر أولًا'
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.management_agreements a
             WHERE a.org_id = org AND a.owner_id = _user AND private.agreement_holds(a.id)) THEN
    RAISE EXCEPTION 'لا يمكن إلغاء ربط مالك بينه وبين مكتبك اتفاقية إدارة سارية — أنهِ الاتفاقية أولًا'
      USING ERRCODE = '23503';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tenants t JOIN public.leases l ON l.tenant_id = t.id
             WHERE t.org_id = org AND t.user_id = _user AND l.status = 'active') THEN
    RAISE EXCEPTION 'لا يمكن إلغاء ربط مستأجر له عقد ساري في مكتبك — أنهِ العقد أولًا'
      USING ERRCODE = '23503';
  END IF;
  DELETE FROM public.org_members WHERE org_id = org AND user_id = _user AND kind = 'client';
  -- The older link table still counts for private.may_link.
  DELETE FROM public.org_clients WHERE org_id = org AND user_id = _user;
END $$;
REVOKE ALL ON FUNCTION public.office_unlink_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_unlink_client(uuid) TO authenticated;

-- Newest definition: 20260924131628. A request made before the account joined the team no longer
-- demotes the staff member to client (L15): it is closed without touching the membership.
CREATE OR REPLACE FUNCTION public.office_decide_link_request(_id uuid, _accept boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r public.link_requests%ROWTYPE;
BEGIN
  SELECT * INTO r FROM public.link_requests WHERE id = _id AND status = 'pending' FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'الطلب غير موجود أو تمت معالجته' USING ERRCODE = '02000'; END IF;
  IF NOT public.is_office_manager() OR public.my_org_id() IS DISTINCT FROM r.org_id THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;

  IF _accept AND EXISTS (SELECT 1 FROM public.org_members m
                         WHERE m.org_id = r.org_id AND m.user_id = r.user_id AND m.kind = 'member') THEN
    UPDATE public.link_requests SET status = 'cancelled' WHERE id = _id;
    RETURN;
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

-- Newest definition: 20260924131628. The office's staff, not its clients, read its incoming requests.
DROP POLICY IF EXISTS link_requests_read ON public.link_requests;
CREATE POLICY link_requests_read ON public.link_requests FOR SELECT TO authenticated USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.org_members m
             WHERE m.org_id = link_requests.org_id AND m.user_id = auth.uid() AND m.kind = 'member')
);
