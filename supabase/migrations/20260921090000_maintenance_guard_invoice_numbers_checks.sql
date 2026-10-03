-- Second hardening pass (2026-09-21). Forward-only: nothing existing is deleted or rewritten.

-- 1) maintenance_requests: RLS lets a tenant insert a request for ANY unit with ANY status/cost, and
--    lets the assigned technician update ANY column (including cost and approval_status, which
--    bypasses the owner-approval rule that only existed in client code). Column rules for callers
--    who are signed in but not office staff. auth.uid() is NULL for the service role, pg_cron and
--    the SQL editor, so server functions and migrations are unaffected.
CREATE OR REPLACE FUNCTION public.guard_maintenance_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A tenant may only open a request for a unit that appears in one of their own leases.
    IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.tenants t ON t.id = l.tenant_id
      WHERE l.unit_id = NEW.unit_id AND t.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'لا يمكنك فتح طلب صيانة لوحدة ليست في عقدك' USING ERRCODE = '42501';
    END IF;
    -- Fields that belong to the office/technician/owner workflow start from their defaults.
    NEW.status := 'new';
    NEW.cost := 0;
    NEW.approval_status := 'not_required';
    NEW.approval_note := NULL;
    NEW.technician_id := NULL;
    NEW.scheduled_at := NULL;
    NEW.rating := NULL;
    NEW.rating_note := NULL;
    NEW.rated_at := NULL;
    RETURN NEW;
  END IF;

  -- UPDATE by a non-staff caller (in practice the assigned technician): status and visit time only.
  IF (to_jsonb(NEW) - 'status' - 'scheduled_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'scheduled_at' - 'updated_at') THEN
    RAISE EXCEPTION 'يمكن للفني تحديث حالة الطلب وموعد الزيارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS maintenance_guard_columns ON public.maintenance_requests;
CREATE TRIGGER maintenance_guard_columns
BEFORE INSERT OR UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION public.guard_maintenance_columns();
REVOKE EXECUTE ON FUNCTION public.guard_maintenance_columns() FROM PUBLIC, anon, authenticated;

-- 2) Invoice numbers were computed in the browser as INV-<year>-<count+1>: two staff issuing at the
--    same time got the same number, and deleting an invoice made the next number collide. The number
--    now comes from a counter row that is locked for the duration of the call, so it is never issued
--    twice. (A failed insert after the number was issued leaves a gap; gapless numbering would need
--    the insert inside the same function.)
CREATE TABLE IF NOT EXISTS public.invoice_counter (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  last_number bigint NOT NULL DEFAULT 0
);
ALTER TABLE public.invoice_counter ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.invoice_counter FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.invoice_counter TO service_role;

-- Start above every existing number so the new sequence can never collide with old invoices.
INSERT INTO public.invoice_counter (singleton, last_number)
SELECT true, GREATEST(
  (SELECT count(*) FROM public.invoices),
  COALESCE((SELECT max((regexp_match(invoice_number, '(\d+)$'))[1]::bigint)
            FROM public.invoices WHERE invoice_number ~ '\d+$'), 0)
)
ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_invoice_number(_year integer DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n bigint;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'إصدار الفواتير لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.invoice_counter (singleton, last_number) VALUES (true, 1)
  ON CONFLICT (singleton) DO UPDATE SET last_number = public.invoice_counter.last_number + 1
  RETURNING last_number INTO n;
  RETURN 'INV-' || COALESCE(_year, EXTRACT(YEAR FROM now() AT TIME ZONE 'Asia/Riyadh')::integer)
         || '-' || lpad(n::text, 4, '0');
END; $$;
REVOKE EXECUTE ON FUNCTION public.next_invoice_number(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_invoice_number(integer) TO authenticated, service_role;

-- Unique numbers, unless the table already contains duplicates (then say so instead of failing).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoices GROUP BY invoice_number HAVING count(*) > 1) THEN
    RAISE NOTICE 'invoices.invoice_number already has duplicates: unique index NOT created. Fix them, then create invoices_invoice_number_key by hand.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_key ON public.invoices (invoice_number);
  END IF;
END $$;

-- Tax invoices must not disappear: only an admin may delete one (staff can still insert/update).
DROP POLICY IF EXISTS invoices_write ON public.invoices;
CREATE POLICY invoices_insert ON public.invoices FOR INSERT TO authenticated
WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY invoices_update ON public.invoices FOR UPDATE TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY invoices_delete ON public.invoices FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

-- 3) Money columns had no constraints, so a direct REST call could store negative amounts. NOT VALID
--    enforces the rule for new and changed rows without scanning (or failing on) existing data.
ALTER TABLE public.payments ADD CONSTRAINT payments_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE public.expenses ADD CONSTRAINT expenses_amount_nonneg CHECK (amount >= 0) NOT VALID;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_amounts_nonneg
  CHECK (subtotal >= 0 AND vat_amount >= 0 AND total >= 0) NOT VALID;
ALTER TABLE public.leases ADD CONSTRAINT leases_amounts_nonneg
  CHECK (annual_rent >= 0 AND deposit >= 0) NOT VALID;
ALTER TABLE public.units ADD CONSTRAINT units_rent_nonneg CHECK (annual_rent >= 0) NOT VALID;
ALTER TABLE public.deals ADD CONSTRAINT deals_amounts_nonneg
  CHECK (value >= 0 AND commission >= 0) NOT VALID;
ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_cost_nonneg
  CHECK (cost >= 0) NOT VALID;
