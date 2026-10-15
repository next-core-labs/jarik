-- Owner dashboard features: owner preferences (auto-approve limit), owner renewal decisions,
-- owner notifications for pending approvals and tenant renewal decisions, and read-only RPCs for
-- the cash-flow forecast, expenses and vacant units.
-- Ownership everywhere is private.unit_owner(): COALESCE(units.owner_id, properties.owner_id).

-- 1) Owner preferences ------------------------------------------------------------------------
-- auto_approve_limit: maintenance whose estimated cost is at or under this is approved on the
-- owner's behalf instead of waiting for them. NULL = always ask.
CREATE TABLE IF NOT EXISTS public.owner_preferences (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  auto_approve_limit numeric CHECK (auto_approve_limit IS NULL OR auto_approve_limit BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.owner_preferences TO authenticated;
GRANT ALL ON public.owner_preferences TO service_role;
ALTER TABLE public.owner_preferences ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS owner_preferences_own ON public.owner_preferences;
CREATE POLICY owner_preferences_own ON public.owner_preferences FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- 2) Auto-approve, enforced in the database --------------------------------------------------
-- The office page decides "pending" client-side; this runs after every other BEFORE trigger
-- (zz_ sorts last), so whoever writes a pending request within the owner's limit, it is approved.
CREATE OR REPLACE FUNCTION private.owner_auto_approve() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _owner uuid;
  _limit numeric;
BEGIN
  IF NEW.approval_status IS DISTINCT FROM 'pending' THEN
    RETURN NEW;
  END IF;
  _owner := private.unit_owner(NEW.unit_id);
  SELECT p.auto_approve_limit INTO _limit FROM public.owner_preferences p WHERE p.owner_id = _owner;
  IF _limit IS NULL OR COALESCE(NEW.cost, 0) > _limit THEN
    RETURN NEW;
  END IF;

  NEW.approval_status := 'approved';
  NEW.approval_note := 'موافقة تلقائية — ضمن الحد الذي حدّده المالك (' ||
    trim(to_char(_limit, 'FM999G999G990')) || ' ر.س)';
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  VALUES (
    _owner, NEW.org_id,
    'وافقنا نيابةً عنك على صيانة: ' || NEW.title,
    'التكلفة المقدّرة ' || trim(to_char(COALESCE(NEW.cost, 0), 'FM999G999G990')) ||
      ' ر.س — ضمن حد الموافقة التلقائية الذي حدّدته',
    'maintenance', 'auto', 'maintenance_requests', NEW.id
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS zz_owner_auto_approve ON public.maintenance_requests;
CREATE TRIGGER zz_owner_auto_approve
  BEFORE INSERT OR UPDATE OF approval_status, cost ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION private.owner_auto_approve();

-- 3) Tell the owner when a decision is waiting on them ---------------------------------------
-- on_maintenance_changed() only fires on status changes and also notifies the tenant; a cost
-- awaiting the owner's approval is for the owner alone.
CREATE OR REPLACE FUNCTION private.notify_owner_pending_approval() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _owner uuid := private.unit_owner(NEW.unit_id);
BEGIN
  IF _owner IS NULL OR NEW.approval_status IS DISTINCT FROM 'pending' THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'pending' AND OLD.cost IS NOT DISTINCT FROM NEW.cost THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  VALUES (
    _owner, NEW.org_id,
    'صيانة تنتظر موافقتك: ' || NEW.title,
    'التكلفة المقدّرة ' || trim(to_char(COALESCE(NEW.cost, 0), 'FM999G999G990')) ||
      ' ر.س — وافق أو ارفض من لوحة المالك',
    'maintenance', 'system', 'maintenance_requests', NEW.id
  );
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS owner_pending_approval_notify ON public.maintenance_requests;
CREATE TRIGGER owner_pending_approval_notify
  AFTER INSERT OR UPDATE OF approval_status, cost ON public.maintenance_requests
  FOR EACH ROW EXECUTE FUNCTION private.notify_owner_pending_approval();

-- 4) Tell the owner what the tenant decided about renewal ------------------------------------
-- Only the decision — the tenant's free-text note was written to the office, not the owner.
CREATE OR REPLACE FUNCTION private.notify_owner_tenant_renewal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _unit uuid;
  _unit_number text;
  _owner uuid;
BEGIN
  SELECT l.unit_id, u.unit_number INTO _unit, _unit_number
  FROM public.leases l JOIN public.units u ON u.id = l.unit_id WHERE l.id = NEW.lease_id;
  _owner := private.unit_owner(_unit);
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

DROP TRIGGER IF EXISTS owner_tenant_renewal_notify ON public.renewal_requests;
CREATE TRIGGER owner_tenant_renewal_notify
  AFTER INSERT ON public.renewal_requests
  FOR EACH ROW EXECUTE FUNCTION private.notify_owner_tenant_renewal();

-- 5) Owner renewal decisions ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_renewal_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  decision text NOT NULL CHECK (decision IN ('renew', 'renew_new_rent', 'leave')),
  proposed_rent numeric CHECK (proposed_rent IS NULL OR proposed_rent > 0),
  note text CHECK (note IS NULL OR char_length(note) <= 400),
  -- superseded: the owner changed their mind; only one 'new' decision per lease at a time.
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled', 'superseded')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((decision = 'renew_new_rent') = (proposed_rent IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS owner_renewal_decisions_open_idx
  ON public.owner_renewal_decisions (lease_id) WHERE status = 'new';

GRANT SELECT ON public.owner_renewal_decisions TO authenticated;
-- Staff only ever mark a decision handled; owners write through owner_submit_renewal_decision().
GRANT UPDATE (status, updated_at) ON public.owner_renewal_decisions TO authenticated;
GRANT ALL ON public.owner_renewal_decisions TO service_role;
ALTER TABLE public.owner_renewal_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS owner_renewal_decisions_read ON public.owner_renewal_decisions;
CREATE POLICY owner_renewal_decisions_read ON public.owner_renewal_decisions FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_staff(auth.uid()));
DROP POLICY IF EXISTS owner_renewal_decisions_staff_update ON public.owner_renewal_decisions;
CREATE POLICY owner_renewal_decisions_staff_update ON public.owner_renewal_decisions FOR UPDATE TO authenticated
  USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
-- Same office isolation as renewal_requests: staff see only their own office's leases.
DROP POLICY IF EXISTS org_isolation ON public.owner_renewal_decisions;
CREATE POLICY org_isolation ON public.owner_renewal_decisions AS RESTRICTIVE FOR ALL TO authenticated
  USING (private.staff_scope_ok(private.org_of_lease(lease_id)))
  WITH CHECK (private.staff_scope_ok(private.org_of_lease(lease_id)));

CREATE OR REPLACE FUNCTION public.owner_submit_renewal_decision(
  _lease_id uuid, _decision text, _proposed_rent numeric DEFAULT NULL, _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.leases l
    WHERE l.id = _lease_id AND l.status = 'active' AND private.unit_owner(l.unit_id) = _uid
  ) THEN
    RAISE EXCEPTION 'هذا العقد ليس عقدًا ساريًا على إحدى وحداتك';
  END IF;
  IF _decision NOT IN ('renew', 'renew_new_rent', 'leave') THEN
    RAISE EXCEPTION 'قرار غير معروف';
  END IF;
  IF _decision = 'renew_new_rent' AND (_proposed_rent IS NULL OR _proposed_rent <= 0) THEN
    RAISE EXCEPTION 'حدّد الإيجار السنوي الجديد';
  END IF;

  UPDATE public.owner_renewal_decisions SET status = 'superseded', updated_at = now()
  WHERE lease_id = _lease_id AND status = 'new';
  INSERT INTO public.owner_renewal_decisions (lease_id, owner_id, decision, proposed_rent, note)
  VALUES (
    _lease_id, _uid, _decision,
    CASE WHEN _decision = 'renew_new_rent' THEN round(_proposed_rent) END,
    NULLIF(left(trim(COALESCE(_note, '')), 400), '')
  )
  RETURNING id INTO _id;
  RETURN _id;
END $$;

-- The owner's view of renewals: their latest decision and the tenant's (decision only) per active
-- lease on their units.
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
    AND private.unit_owner(l.unit_id) = auth.uid()
    AND (d.decision IS NOT NULL OR r.decision IS NOT NULL)
$$;

-- 6) Cash-flow forecast: what falls due each month from this month on, and how much of it is paid.
CREATE OR REPLACE FUNCTION public.owner_cashflow_forecast()
RETURNS TABLE(month text, due numeric, paid numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH today AS (SELECT (now() AT TIME ZONE 'Asia/Riyadh')::date AS d),
  pay AS (
    SELECT pay.amount, pay.due_date, pay.status
    FROM public.payments pay
    JOIN public.leases l ON l.id = pay.lease_id
    WHERE auth.uid() IS NOT NULL AND private.unit_owner(l.unit_id) = auth.uid()
  )
  SELECT to_char(m, 'YYYY-MM'),
         COALESCE(sum(pay.amount), 0),
         COALESCE(sum(pay.amount) FILTER (WHERE pay.status = 'paid'), 0)
  FROM generate_series(
         date_trunc('month', (SELECT d FROM today)::timestamp),
         date_trunc('month', (SELECT d FROM today)::timestamp) + interval '5 months',
         interval '1 month') AS m
  LEFT JOIN pay ON date_trunc('month', pay.due_date::timestamp) = m
  GROUP BY m ORDER BY m
$$;

-- 7) Expenses over the last 12 months, itemised (same scope as owner_finance_summary()).
CREATE OR REPLACE FUNCTION public.owner_expenses_12m()
RETURNS TABLE(
  id uuid, expense_date date, title text, category text, amount numeric,
  property_name text, unit_number text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.expense_date, e.title, NULLIF(trim(e.category), ''), e.amount,
         COALESCE(pu.name, pp.name), u.unit_number
  FROM public.expenses e
  LEFT JOIN public.units u ON u.id = e.unit_id
  LEFT JOIN public.properties pu ON pu.id = u.property_id
  LEFT JOIN public.properties pp ON pp.id = e.property_id
  WHERE auth.uid() IS NOT NULL
    AND e.expense_date > ((now() AT TIME ZONE 'Asia/Riyadh')::date - interval '12 months')::date
    AND (
      (e.unit_id IS NOT NULL AND private.unit_owner(e.unit_id) = auth.uid())
      OR (e.unit_id IS NULL AND pp.owner_id = auth.uid())
    )
  ORDER BY e.expense_date DESC
$$;

-- 8) Vacant units: how long, whether the public sees them, and what similar units rent for.
-- Peers are units of the same type in the same district managed by the same office, like
-- market_stats(); the average is only given over 3+ peers so it never reveals one unit's rent.
CREATE OR REPLACE FUNCTION public.owner_vacancies()
RETURNS TABLE(
  unit_id uuid, vacant_since timestamptz, market_listed boolean, publicly_listed boolean,
  photos_count bigint, peer_avg_rent numeric, peer_units bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.vacant_since::timestamptz, u.market_listed,
         EXISTS (SELECT 1 FROM public.vacant_units_public v WHERE v.id = u.id),
         (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id),
         CASE WHEN peers.n >= 3 THEN round(peers.avg_rent) END,
         peers.n
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, avg(u2.annual_rent) AS avg_rent
    FROM public.units u2 JOIN public.properties p2 ON p2.id = u2.property_id
    WHERE u2.id <> u.id AND u2.listing_purpose <> 'sale' AND u2.annual_rent > 0
      AND u2.unit_type = u.unit_type
      AND p2.org_id IS NOT DISTINCT FROM p.org_id
      AND COALESCE(NULLIF(u2.district, ''), p2.district) = COALESCE(NULLIF(u.district, ''), p.district)
  ) peers ON true
  WHERE auth.uid() IS NOT NULL AND u.status = 'vacant'
    AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.owner_submit_renewal_decision(uuid, text, numeric, text)', 'public.owner_renewals()',
    'public.owner_cashflow_forecast()', 'public.owner_expenses_12m()', 'public.owner_vacancies()'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.owner_auto_approve(), private.notify_owner_pending_approval(),
  private.notify_owner_tenant_renewal() FROM PUBLIC, anon, authenticated;
