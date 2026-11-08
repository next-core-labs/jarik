-- The office now picks a lease's END DATE (as written on the contract) instead of choosing from
-- 1 / 3 / 6 / 12 months; the term follows from it in whole months. Multi-year leases are common,
-- so any whole number of months from 1 to 60 is accepted. Rent stays annual (annual_rent) and the
-- contract total is still annual_rent × term_months / 12 (private.lease_schedule, unchanged).

ALTER TABLE public.leases DROP CONSTRAINT IF EXISTS leases_term_months_check;
ALTER TABLE public.leases ADD CONSTRAINT leases_term_months_check
  CHECK (term_months BETWEEN 1 AND 60);

-- The checks every lease writer applies to its terms (create_lease, renew_lease, correct_lease).
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
  IF _term_months IS NULL OR _term_months < 1 OR _term_months > 60 THEN
    RAISE EXCEPTION 'مدة العقد يجب أن تكون من شهر واحد إلى 5 سنوات بالأشهر الكاملة' USING ERRCODE = '22023';
  END IF;
  IF _installments > _term_months THEN
    RAISE EXCEPTION 'عدد الدفعات لا يجوز أن يتجاوز مدة العقد بالأشهر' USING ERRCODE = '22023';
  END IF;
END $$;
REVOKE ALL ON FUNCTION private.check_lease_terms(date, integer, numeric, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.check_lease_terms(date, integer, numeric, integer) TO authenticated, service_role;
