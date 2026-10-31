-- Publishing a unit on the public website (سوق العروض) is paid: 50 SAR (VAT-inclusive) buys 30 days,
-- charged through a Moyasar hosted invoice (same flow as usil). The office pays, Moyasar confirms, the
-- server settles the payment with the service role, and only then is the unit listed until
-- market_paid_until. A renewal paid before expiry extends from the current end date.
--
-- Units already listed when this ships stay listed for free (market_paid_until NULL): the guard below
-- only stops a unit going from unlisted to listed. Once such a unit is unlisted, listing it again is paid.

-- ── 1. Paid-until date on the unit ───────────────────────────────────────────────────────────────
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS market_paid_until timestamptz;

COMMENT ON COLUMN public.units.market_paid_until IS
  'End of the paid website-publication period; NULL = never paid (units listed before paid publishing stay listed)';

-- ── 2. One row per Moyasar invoice raised for a unit's publication ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.listing_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  amount_halalas integer NOT NULL DEFAULT 5000 CHECK (amount_halalas >= 100),
  currency text NOT NULL DEFAULT 'SAR',
  period_days integer NOT NULL DEFAULT 30 CHECK (period_days BETWEEN 1 AND 366),
  status text NOT NULL DEFAULT 'initiated' CHECK (status IN ('initiated', 'paid', 'cancelled')),
  moyasar_invoice_id text UNIQUE,
  invoice_url text,
  moyasar_payment_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- At most one open invoice per unit, so a double click cannot let the office pay twice.
CREATE UNIQUE INDEX IF NOT EXISTS listing_payments_one_open_per_unit
  ON public.listing_payments (unit_id) WHERE status = 'initiated';
CREATE INDEX IF NOT EXISTS listing_payments_org_idx ON public.listing_payments (org_id, created_at DESC);

ALTER TABLE public.listing_payments ENABLE ROW LEVEL SECURITY;
-- Written only by the server (service role); the office's staff can read their own office's rows.
REVOKE ALL ON public.listing_payments FROM anon, authenticated;
GRANT SELECT ON public.listing_payments TO authenticated;
GRANT ALL ON public.listing_payments TO service_role;

DROP POLICY IF EXISTS listing_payments_office_read ON public.listing_payments;
CREATE POLICY listing_payments_office_read ON public.listing_payments FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = listing_payments.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
    )
  );

-- ── 3. A signed-in user cannot publish an unpaid unit, nor set the paid-until date ───────────────
-- The server (service role) and cron run with no auth.uid(), so settlement and expiry pass.
CREATE OR REPLACE FUNCTION private.guard_market_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.market_paid_until := NULL;
  ELSE
    NEW.market_paid_until := OLD.market_paid_until;
  END IF;

  IF NEW.market_listed AND (TG_OP = 'INSERT' OR NOT OLD.market_listed)
     AND (NEW.market_paid_until IS NULL OR NEW.market_paid_until <= now()) THEN
    RAISE EXCEPTION 'نشر الوحدة في الموقع يتطلب دفع رسوم النشر (50 ريال لكل 30 يومًا)'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- After a0_guard_owner_unit (which already forces an owner's market fields back).
DROP TRIGGER IF EXISTS a2_guard_market_publish ON public.units;
CREATE TRIGGER a2_guard_market_publish BEFORE INSERT OR UPDATE ON public.units
  FOR EACH ROW EXECUTE FUNCTION private.guard_market_publish();

-- ── 4. Who may pay for a unit, and whether its office can appear on the website ──────────────────
-- Same office resolution as vacant_units_public: the property's office, or for an owner-registered
-- property the office with an active management agreement. Returns no row unless the caller is staff
-- in that office.
CREATE OR REPLACE FUNCTION public.listing_publish_target(_unit_id uuid)
RETURNS TABLE (org_id uuid, office_ready boolean, unit_label text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.id,
    (o.listed_publicly AND o.verified),
    concat_ws(' · ', 'وحدة ' || u.unit_number, u.unit_type, p.name)
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  JOIN public.org_settings o ON o.id = COALESCE(p.org_id, private.unit_agreement_org(u.id))
  WHERE u.id = _unit_id
    AND public.is_staff(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = o.id AND m.user_id = auth.uid() AND m.kind = 'member'
    )
$$;
REVOKE ALL ON FUNCTION public.listing_publish_target(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listing_publish_target(uuid) TO authenticated;

-- ── 5. Settlement: called by the server only after Moyasar confirms the payment ──────────────────
-- Idempotent: the browser return and the webhook may both arrive.
CREATE OR REPLACE FUNCTION public.settle_listing_payment(_payment_id uuid, _moyasar_payment_id text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay public.listing_payments%ROWTYPE; until timestamptz;
BEGIN
  SELECT * INTO pay FROM public.listing_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing payment % not found', _payment_id USING ERRCODE = 'P0002';
  END IF;

  IF pay.status = 'paid' THEN
    SELECT market_paid_until INTO until FROM public.units WHERE id = pay.unit_id;
    RETURN until;
  END IF;

  UPDATE public.listing_payments
  SET status = 'paid', paid_at = now(), moyasar_payment_id = NULLIF(btrim(_moyasar_payment_id), '')
  WHERE id = pay.id;

  UPDATE public.units
  SET market_paid_until = greatest(coalesce(market_paid_until, now()), now())
                          + make_interval(days => pay.period_days),
      market_listed_at = CASE WHEN market_listed THEN market_listed_at ELSE now() END,
      market_listed = true
  WHERE id = pay.unit_id
  RETURNING market_paid_until INTO until;

  -- notify_unit_staff wants a staff caller; the server has none, so the office is notified directly.
  PERFORM private.notify_org_staff(pay.org_id, 'تم نشر الوحدة في الموقع',
    'تم استلام رسوم النشر، والوحدة معروضة في سوق العروض حتى ' || to_char(until AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || '.',
    'unit', 'units', pay.unit_id);
  RETURN until;
END $$;
REVOKE ALL ON FUNCTION public.settle_listing_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_listing_payment(uuid, text) TO service_role;

-- ── 6. Expiry: a paid period that ran out takes the unit off the website ─────────────────────────
CREATE OR REPLACE FUNCTION public.expire_paid_market_listings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.units SET market_listed = false
    WHERE market_listed AND market_paid_until IS NOT NULL AND market_paid_until <= now()
    RETURNING id, property_id
  LOOP
    PERFORM private.notify_org_staff(
      (SELECT COALESCE(p.org_id, private.unit_agreement_org(r.id)) FROM public.properties p WHERE p.id = r.property_id),
      'انتهت مدة نشر الوحدة',
      'انتهت مدة النشر المدفوعة وأُخفيت الوحدة من سوق العروض. جدّد النشر من «الأملاك والوحدات».',
      'unit', 'units', r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.expire_paid_market_listings() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-paid-market-listings') THEN
    PERFORM cron.schedule('expire-paid-market-listings', '*/10 * * * *', 'SELECT public.expire_paid_market_listings()');
  END IF;
END $$;
