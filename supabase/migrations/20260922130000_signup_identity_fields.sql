-- =============================================================================================
-- Signing up now says who you are: an office, an owner or a tenant, with the identity document
-- that fits. An office is a Saudi business, so it gives a national ID and its «فال» licence; an
-- owner or a tenant may be a resident, so an iqama is accepted too.
-- =============================================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS national_id text,
  ADD COLUMN IF NOT EXISTS id_type text,
  ADD COLUMN IF NOT EXISTS account_type text,
  ADD COLUMN IF NOT EXISTS fal_license_no text;

DO $$
BEGIN
  -- 10 digits: 1xxxxxxxxx for a citizen, 2xxxxxxxxx for a resident. Null stays allowed, because
  -- accounts created before this (and Google sign-ins) never gave one.
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_national_id_format
    CHECK (national_id IS NULL OR national_id ~ '^[12][0-9]{9}$') NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_id_type_check
    CHECK (id_type IS NULL OR id_type IN ('national', 'iqama'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_type_check
    CHECK (account_type IS NULL OR account_type IN ('office', 'owner', 'tenant'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- An office is a company registered in Saudi Arabia: it is identified by a national ID, never an
-- iqama, and it is the only account type that carries a «فال» licence.
DO $$
BEGIN
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_office_identity
    CHECK (account_type IS DISTINCT FROM 'office'
           OR (id_type IS DISTINCT FROM 'iqama')) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- The same national id must not be claimed by two accounts.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_national_id_key
  ON public.profiles (national_id) WHERE national_id IS NOT NULL;

/**
 * Carry the sign-up fields onto the profile. The values come from raw_user_meta_data, which the
 * account itself supplies, so each one is validated here rather than trusted: a bad value is
 * dropped instead of failing the sign-up, because refusing to create the account would leave the
 * person with an auth user and no profile.
 */
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  m jsonb := coalesce(NEW.raw_user_meta_data, '{}'::jsonb);
  nid text := nullif(regexp_replace(coalesce(m->>'national_id', ''), '\D', '', 'g'), '');
  acct text := m->>'account_type';
  idt text := m->>'id_type';
  fal text := nullif(trim(coalesce(m->>'fal_license_no', '')), '');
BEGIN
  IF nid IS NOT NULL AND nid !~ '^[12][0-9]{9}$' THEN nid := NULL; END IF;
  IF acct IS NOT NULL AND acct NOT IN ('office', 'owner', 'tenant') THEN acct := NULL; END IF;
  IF idt IS NOT NULL AND idt NOT IN ('national', 'iqama') THEN idt := NULL; END IF;
  -- An office never holds an iqama, whatever the form sent.
  IF acct = 'office' THEN idt := 'national'; ELSE fal := NULL; END IF;
  -- Someone else may already hold this id; the profile is still created, without it.
  IF nid IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles WHERE national_id = nid) THEN
    nid := NULL;
  END IF;

  INSERT INTO public.profiles (id, full_name, phone, national_id, id_type, account_type, fal_license_no)
  VALUES (NEW.id, m->>'full_name', m->>'phone', nid, idt, acct, fal)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

-- The account's own profile row is the only one it may write, and these columns are part of it.
-- (profiles_update already restricts it to id = auth.uid().)
