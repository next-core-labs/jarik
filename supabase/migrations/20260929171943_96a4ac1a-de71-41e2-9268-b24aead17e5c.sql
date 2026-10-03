CREATE TABLE public.site_visits (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  path text NOT NULL,
  visitor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX site_visits_created_idx ON public.site_visits (created_at);
CREATE INDEX site_visits_visitor_idx ON public.site_visits (visitor_id);
ALTER TABLE public.site_visits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_visits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.site_visits TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.site_visits_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.site_visit_stats() RETURNS TABLE(
  total_visits bigint, unique_visitors bigint, visits_30d bigint, unique_visitors_30d bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT
    (SELECT count(*) FROM public.site_visits),
    (SELECT count(DISTINCT visitor_id) FROM public.site_visits),
    (SELECT count(*) FROM public.site_visits WHERE created_at >= now() - interval '30 days'),
    (SELECT count(DISTINCT visitor_id) FROM public.site_visits WHERE created_at >= now() - interval '30 days')
$$;
REVOKE ALL ON FUNCTION public.site_visit_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.site_visit_stats() TO service_role;

ALTER TABLE public.hq_admins DROP CONSTRAINT hq_admins_permissions_check;
ALTER TABLE public.hq_admins ADD CONSTRAINT hq_admins_permissions_check
  CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system', 'announcements']::text[]);
ALTER TABLE public.hq_invitations DROP CONSTRAINT hq_invitations_permissions_check;
ALTER TABLE public.hq_invitations ADD CONSTRAINT hq_invitations_permissions_check
  CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system', 'announcements']::text[]);

CREATE OR REPLACE FUNCTION public.invite_hq_admin(_email text, _permissions text[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط' USING ERRCODE = '42501';
  END IF;
  IF _email IS NULL OR position('@' in _email) = 0 THEN
    RAISE EXCEPTION 'اكتب بريدًا إلكترونيًا صحيحًا' USING ERRCODE = '22023';
  END IF;
  IF _permissions IS NULL OR NOT (_permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system', 'announcements']::text[]) THEN
    RAISE EXCEPTION 'صلاحية غير معروفة' USING ERRCODE = '22023';
  END IF;
  IF NOT public.check_rate_limit('hq-invite', 20, 3600) THEN
    RAISE EXCEPTION 'دعوات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.hq_invitations (email, permissions, invited_by)
  VALUES (trim(_email), _permissions, auth.uid())
  RETURNING id INTO inv_id;
  RETURN inv_id;
EXCEPTION WHEN unique_violation THEN
  RAISE EXCEPTION 'عنده دعوة معلّقة أصلًا' USING ERRCODE = '23505';
END $$;

CREATE TABLE public.platform_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  recipient_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX platform_announcements_created_idx ON public.platform_announcements (created_at DESC);
GRANT ALL ON public.platform_announcements TO service_role;
ALTER TABLE public.platform_announcements ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types,
       COALESCE(NULLIF(op.phone, ''), pri.office_phone) AS phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), pri.whatsapp_number, pri.office_phone) AS whatsapp,
       op.avatar_path,
       (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op
LEFT JOIN LATERAL (
  SELECT s.office_phone, s.whatsapp_number FROM public.org_settings s
  WHERE s.listed_publicly ORDER BY s.created_at, s.id LIMIT 1
) pri ON true
WHERE op.published
  AND EXISTS (
    SELECT 1 FROM public.properties p
    JOIN public.org_settings o ON o.id = p.org_id AND o.listed_publicly AND o.verified
    WHERE p.owner_id = op.owner_id
    UNION ALL
    SELECT 1 FROM public.units u
    JOIN public.properties p2 ON p2.id = u.property_id
    JOIN public.org_settings o2 ON o2.id = p2.org_id AND o2.listed_publicly AND o2.verified
    WHERE u.owner_id = op.owner_id
  );
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;

CREATE OR REPLACE FUNCTION private.user_in_org(_uid uuid, _org uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _uid IS NOT NULL AND _org IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.org_members WHERE user_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.properties WHERE owner_id = _uid AND org_id = _org)
    OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
               WHERE u.owner_id = _uid AND p.org_id = _org)
    OR EXISTS (SELECT 1 FROM public.tenants WHERE user_id = _uid AND org_id = _org)
  )
$$;
REVOKE EXECUTE ON FUNCTION private.user_in_org(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.user_in_org(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.market_stats()
RETURNS TABLE(district text, units_count bigint, avg_rent numeric, occupancy_pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(NULLIF(u.district, ''), p.district, 'غير محدد'),
         count(*), round(avg(u.annual_rent)),
         round(100.0 * count(*) FILTER (WHERE u.status = 'occupied') / count(*))
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  WHERE u.listing_purpose <> 'sale'
    AND private.user_in_org(auth.uid(), p.org_id)
  GROUP BY 1 ORDER BY 1
$$;

DROP POLICY IF EXISTS org_isolation ON public.audit_log;
CREATE POLICY org_isolation ON public.audit_log AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));

ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS provider_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_channel_provider_msg_idx
  ON public.whatsapp_messages (channel_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;