-- =============================================================================================
-- Foundation for the separate tenant login system and the owner portal's self-registration:
--   1) login_attempts — failed-login lockout, keyed by email (pre-auth, so the existing
--      check_rate_limit()/rate_limits pair cannot be used: it requires auth.uid() and raises for
--      an unauthenticated caller by design). Internal-only, exactly like rate_limits: RLS enabled,
--      zero policies, service_role only — no anon/authenticated grant at all.
--   2) tenant_invites — a lease-scoped pending-activation record. This codebase has NO custom
--      email-sending infrastructure at all (grepped: only Supabase Auth's own built-in emails —
--      signup OTP, password recovery — are used anywhere); building a fully custom invite-token
--      system would require standing up a new email provider integration, real scope creep this
--      migration does not take on. Instead, the invite itself is sent via Supabase Auth's own
--      admin.inviteUserByEmail() (reuses the exact email delivery already proven working in this
--      project). This table only tracks WHICH lease a pending invite is for, so that once the
--      invitee accepts Supabase's own invite link and lands back in the app authenticated, the
--      activation page can look up their pending invite and complete tenants.user_id linking —
--      Supabase's own link is the real security token; this row is just application context.
--      Internal-only: every access goes through server functions using the service-role client.
--   3) building_announcements — a property-wide broadcast from the office to every tenant/owner of
--      that property, distinct from the existing 1:1 unit_messages chat. Same org_isolation
--      RESTRICTIVE pattern as every other office-owned table (20260924110000).
--   4) assign_default_role() — today EVERY self-registered account becomes 'tenant' regardless of
--      the account-type picker (deliberately, since auto-granting 'staff' was the exact hole closed
--      in 20260920190000). 'owner' carries none of that risk (an owner only ever sees rows where
--      owner_id = auth.uid() — never another account's data), so it is safe to also auto-grant from
--      the signup form's own choice. Every other choice (including 'office') keeps falling through
--      to the existing safe 'tenant' default unchanged — becoming staff still requires an explicit
--      admin promotion or register_office(), neither touched here.
-- =============================================================================================

CREATE TABLE IF NOT EXISTS public.login_attempts (
  email text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.login_attempts TO service_role;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.tenant_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  email text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tenant_invites_lease_idx ON public.tenant_invites (lease_id);
GRANT ALL ON public.tenant_invites TO service_role;
ALTER TABLE public.tenant_invites ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.building_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  title text NOT NULL,
  body text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS building_announcements_property_idx
  ON public.building_announcements (property_id, created_at DESC);
GRANT SELECT ON public.building_announcements TO authenticated;
GRANT INSERT ON public.building_announcements TO authenticated;
GRANT ALL ON public.building_announcements TO service_role;
ALTER TABLE public.building_announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY building_announcements_read ON public.building_announcements
FOR SELECT TO authenticated USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.leases l
    JOIN public.tenants t ON t.id = l.tenant_id
    JOIN public.units u ON u.id = l.unit_id
    WHERE u.property_id = building_announcements.property_id
      AND t.user_id = auth.uid() AND l.status = 'active'
  )
);
CREATE POLICY building_announcements_staff_write ON public.building_announcements
FOR INSERT TO authenticated WITH CHECK (public.is_staff(auth.uid()));

-- Same RESTRICTIVE cross-office boundary as every other office-owned table.
CREATE POLICY org_isolation ON public.building_announcements AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

CREATE OR REPLACE FUNCTION public.assign_default_role() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing_count integer; chosen text;
BEGIN
  SELECT count(*) INTO existing_count FROM public.user_roles;
  IF existing_count = 0 THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'admin') ON CONFLICT DO NOTHING;
    RETURN NEW;
  END IF;

  chosen := NEW.raw_user_meta_data ->> 'account_type';
  IF chosen = 'owner' THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'owner') ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'tenant') ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
