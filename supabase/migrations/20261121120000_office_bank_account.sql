-- The office's bank account, shown to its own tenants when a rent installment is due.
-- Until now the tenant was told to ask the office for it in chat (next-payment-card).
--
-- Who sees it: the office's own people (org_settings is already closed to everyone else,
-- 20261106120100) and, through lease_bank_details(), the tenant of a lease that office manages.
-- It is on no public view: office_directory and office_pages_public list their columns one by one.
-- Who changes it: the office's manager only — a swapped IBAN redirects every tenant's rent.
-- Forward-only.

ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS bank_name text,
  ADD COLUMN IF NOT EXISTS bank_account_holder text,
  ADD COLUMN IF NOT EXISTS bank_iban text,
  ADD COLUMN IF NOT EXISTS bank_account_no text;

COMMENT ON COLUMN public.org_settings.bank_iban IS
  'Saudi IBAN, stored without spaces (SA + 22 digits). Tenants of the office read it through lease_bank_details().';

ALTER TABLE public.org_settings
  DROP CONSTRAINT IF EXISTS org_settings_bank_iban_format,
  DROP CONSTRAINT IF EXISTS org_settings_bank_account_no_format,
  DROP CONSTRAINT IF EXISTS org_settings_bank_text_length;
ALTER TABLE public.org_settings
  ADD CONSTRAINT org_settings_bank_iban_format
    CHECK (bank_iban IS NULL OR bank_iban ~ '^SA[0-9]{22}$'),
  ADD CONSTRAINT org_settings_bank_account_no_format
    CHECK (bank_account_no IS NULL OR bank_account_no ~ '^[0-9]{6,30}$'),
  ADD CONSTRAINT org_settings_bank_text_length
    CHECK (char_length(COALESCE(bank_name, '')) <= 80
       AND char_length(COALESCE(bank_account_holder, '')) <= 120);

-- Manager-only, enforced here and not only in the form: org_write lets any staff member update the
-- row through the REST API. auth.uid() is NULL for the service role and the SQL editor.
CREATE OR REPLACE FUNCTION public.guard_office_bank_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF (NEW.bank_name, NEW.bank_account_holder, NEW.bank_iban, NEW.bank_account_no)
       IS DISTINCT FROM
     (OLD.bank_name, OLD.bank_account_holder, OLD.bank_iban, OLD.bank_account_no)
     AND auth.uid() IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members m
       WHERE m.org_id = NEW.id AND m.user_id = auth.uid() AND m.kind = 'member' AND m.is_manager
     ) THEN
    RAISE EXCEPTION 'تعديل الحساب البنكي لمدير المكتب فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_office_bank_account() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS org_settings_guard_bank_account ON public.org_settings;
CREATE TRIGGER org_settings_guard_bank_account
BEFORE UPDATE ON public.org_settings
FOR EACH ROW EXECUTE FUNCTION public.guard_office_bank_account();

-- The tenant's side: the account to transfer rent to, for one of their own leases. No row when the
-- lease is not theirs, no office manages it, or the office has not entered an IBAN yet.
CREATE OR REPLACE FUNCTION public.lease_bank_details(_lease_id uuid)
RETURNS TABLE(
  office_name text, bank_name text, account_holder text, iban text, account_no text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT o.company_name, o.bank_name, COALESCE(NULLIF(o.bank_account_holder, ''), o.company_name),
         o.bank_iban, o.bank_account_no
  FROM public.leases l
  JOIN public.tenants t ON t.id = l.tenant_id
  JOIN public.org_settings o ON o.id = private.org_of_lease(l.id)
  WHERE l.id = _lease_id
    AND auth.uid() IS NOT NULL
    AND t.user_id = auth.uid()
    AND o.bank_iban IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.lease_bank_details(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lease_bank_details(uuid) TO authenticated;
