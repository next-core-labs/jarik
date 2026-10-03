
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS verified boolean NOT NULL DEFAULT false;
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS banner_path text;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS listing_purpose text NOT NULL DEFAULT 'rent';
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS sale_price numeric;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS listing_description text;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS amenities text[] NOT NULL DEFAULT '{}';
ALTER TABLE public.unit_photos RENAME COLUMN file_path TO path;
ALTER TABLE public.unit_photos RENAME COLUMN sort_order TO position;

CREATE TABLE IF NOT EXISTS public.org_members (
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'member',
  role text NOT NULL DEFAULT 'staff',
  is_manager boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);
GRANT SELECT ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members see their org" ON public.org_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = org_members.org_id AND m.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  email text NOT NULL,
  kind text NOT NULL DEFAULT 'member',
  role text NOT NULL DEFAULT 'staff',
  is_manager boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.invitations TO authenticated;
GRANT ALL ON public.invitations TO service_role;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invitee sees own invitations" ON public.invitations FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email'));
CREATE POLICY "org members see org invitations" ON public.invitations FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.org_members m WHERE m.org_id = invitations.org_id AND m.user_id = auth.uid()));

CREATE TABLE IF NOT EXISTS public.owner_pages (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  bio text,
  areas text,
  property_types text,
  phone text,
  whatsapp text,
  avatar_path text,
  published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.owner_pages TO authenticated;
GRANT ALL ON public.owner_pages TO service_role;
ALTER TABLE public.owner_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff manage owner pages" ON public.owner_pages FOR ALL TO authenticated
  USING (public.is_staff(auth.uid()) OR owner_id = auth.uid())
  WITH CHECK (public.is_staff(auth.uid()) OR owner_id = auth.uid());
CREATE POLICY "anyone signed in reads owner pages" ON public.owner_pages FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION public.my_org()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.org_members WHERE user_id = auth.uid() AND kind = 'member' LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.my_org() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_org() TO authenticated;

CREATE OR REPLACE FUNCTION public.org_of(_table text, _id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE r uuid;
BEGIN
  IF _table = 'properties' THEN SELECT o.id INTO r FROM public.properties p JOIN public.org_members m ON m.user_id = p.owner_id AND m.kind='member' JOIN public.org_settings o ON o.id = m.org_id WHERE p.id = _id LIMIT 1;
  ELSIF _table = 'units' THEN SELECT o.id INTO r FROM public.units u JOIN public.org_members m ON m.user_id = u.owner_id AND m.kind='member' JOIN public.org_settings o ON o.id = m.org_id WHERE u.id = _id LIMIT 1;
  ELSIF _table = 'leases' THEN SELECT o.id INTO r FROM public.leases l JOIN public.units u ON u.id = l.unit_id JOIN public.org_members m ON m.user_id = u.owner_id AND m.kind='member' JOIN public.org_settings o ON o.id = m.org_id WHERE l.id = _id LIMIT 1;
  ELSIF _table = 'payments' THEN SELECT o.id INTO r FROM public.payments p JOIN public.leases l ON l.id = p.lease_id JOIN public.units u ON u.id = l.unit_id JOIN public.org_members m ON m.user_id = u.owner_id AND m.kind='member' JOIN public.org_settings o ON o.id = m.org_id WHERE p.id = _id LIMIT 1;
  ELSIF _table = 'tenants' THEN SELECT o.id INTO r FROM public.tenants t JOIN public.org_members m ON m.user_id = t.user_id JOIN public.org_settings o ON o.id = m.org_id WHERE t.id = _id LIMIT 1;
  ELSIF _table = 'maintenance_requests' THEN SELECT o.id INTO r FROM public.maintenance_requests q JOIN public.units u ON u.id = q.unit_id JOIN public.org_members m ON m.user_id = u.owner_id AND m.kind='member' JOIN public.org_settings o ON o.id = m.org_id WHERE q.id = _id LIMIT 1;
  ELSIF _table = 'unit_requests' THEN SELECT o.id INTO r FROM public.unit_requests x JOIN public.units u ON u.id = x.unit_id JOIN public.org_members m ON m.user_id = u.owner_id AND m.kind='member' JOIN public.org_settings o ON o.id = m.org_id WHERE x.id = _id LIMIT 1;
  ELSIF _table = 'whatsapp_channels' THEN SELECT w.org_id INTO r FROM public.whatsapp_channels w WHERE w.id = _id LIMIT 1;
  END IF;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.org_of(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_of(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.org_user_ids(_org uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(SELECT user_id FROM public.org_members WHERE org_id = _org)
$$;
REVOKE ALL ON FUNCTION public.org_user_ids(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.org_user_ids(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.orgs_of_user(_uid uuid)
RETURNS uuid[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT ARRAY(SELECT org_id FROM public.org_members WHERE user_id = _uid)
$$;
REVOKE ALL ON FUNCTION public.orgs_of_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orgs_of_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.office_people()
RETURNS TABLE(user_id uuid, email text, full_name text, phone text, roles text[], relation text, is_manager boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.my_org();
BEGIN
  IF _org IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT m.user_id, u.email::text, COALESCE(p.full_name,'')::text, COALESCE(p.phone,'')::text,
    COALESCE((SELECT array_agg(r.role::text) FROM public.user_roles r WHERE r.user_id = m.user_id), '{}'),
    CASE WHEN m.kind = 'member' THEN 'member' ELSE 'client' END::text, m.is_manager
  FROM public.org_members m
  JOIN auth.users u ON u.id = m.user_id
  LEFT JOIN public.profiles p ON p.id = m.user_id
  WHERE m.org_id = _org;
END $$;
REVOKE ALL ON FUNCTION public.office_people() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_people() TO authenticated;

CREATE OR REPLACE FUNCTION public.office_invitations()
RETURNS TABLE(id uuid, email text, kind text, role text, is_manager boolean, created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.email, i.kind, i.role, i.is_manager, i.created_at
  FROM public.invitations i
  WHERE i.org_id = public.my_org() AND i.status = 'pending'
  ORDER BY i.created_at DESC
$$;
REVOKE ALL ON FUNCTION public.office_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_invitations() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_office_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin') OR EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.user_id = auth.uid() AND m.kind = 'member' AND m.is_manager)
$$;
REVOKE ALL ON FUNCTION public.is_office_manager() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_office_manager() TO authenticated;

CREATE OR REPLACE FUNCTION public.office_add_member(_email text, _role text, _manager boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.my_org();
BEGIN
  IF _org IS NULL OR NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF _role NOT IN ('staff','technician') THEN RAISE EXCEPTION 'دور غير صالح'; END IF;
  INSERT INTO public.invitations (org_id, email, kind, role, is_manager)
  VALUES (_org, lower(trim(_email)), 'member', _role, COALESCE(_manager, false));
END $$;
REVOKE ALL ON FUNCTION public.office_add_member(text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_add_member(text, text, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.office_link_client(_email text, _kind text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid := public.my_org();
BEGIN
  IF _org IS NULL OR NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  IF _kind NOT IN ('owner','tenant') THEN RAISE EXCEPTION 'نوع غير صالح'; END IF;
  INSERT INTO public.invitations (org_id, email, kind, role, is_manager)
  VALUES (_org, lower(trim(_email)), 'client', _kind, false);
END $$;
REVOKE ALL ON FUNCTION public.office_link_client(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_link_client(text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.office_revoke_invitation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  UPDATE public.invitations SET status = 'revoked', updated_at = now()
  WHERE id = _id AND org_id = public.my_org() AND status = 'pending';
END $$;
REVOKE ALL ON FUNCTION public.office_revoke_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_revoke_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.office_remove_member(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  DELETE FROM public.org_members WHERE org_id = public.my_org() AND user_id = _user AND user_id <> auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.office_remove_member(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_remove_member(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.office_set_manager(_user uuid, _manager boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  UPDATE public.org_members SET is_manager = COALESCE(_manager, false)
  WHERE org_id = public.my_org() AND user_id = _user AND kind = 'member';
END $$;
REVOKE ALL ON FUNCTION public.office_set_manager(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_set_manager(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.office_unlink_client(_user uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_office_manager() THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  DELETE FROM public.org_members WHERE org_id = public.my_org() AND user_id = _user AND kind = 'client';
END $$;
REVOKE ALL ON FUNCTION public.office_unlink_client(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.office_unlink_client(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_invitations()
RETURNS TABLE(id uuid, org_id uuid, office_name text, kind text, role text, is_manager boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id, i.org_id, COALESCE(o.company_name, 'مكتب')::text, i.kind, i.role, i.is_manager
  FROM public.invitations i JOIN public.org_settings o ON o.id = i.org_id
  WHERE i.status = 'pending' AND lower(i.email) = lower(auth.jwt() ->> 'email')
$$;
REVOKE ALL ON FUNCTION public.my_invitations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_invitations() TO authenticated;

CREATE OR REPLACE FUNCTION public.accept_invitation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE inv public.invitations;
BEGIN
  SELECT * INTO inv FROM public.invitations WHERE id = _id AND status = 'pending'
    AND lower(email) = lower(auth.jwt() ->> 'email');
  IF NOT FOUND THEN RAISE EXCEPTION 'الدعوة غير موجودة أو انتهت'; END IF;
  INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
  VALUES (inv.org_id, auth.uid(), inv.kind, inv.role, inv.is_manager)
  ON CONFLICT (org_id, user_id) DO UPDATE SET kind = EXCLUDED.kind, role = EXCLUDED.role, is_manager = EXCLUDED.is_manager;
  INSERT INTO public.user_roles (user_id, role) VALUES (auth.uid(), inv.role::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.invitations SET status = 'accepted', updated_at = now() WHERE id = _id;
END $$;
REVOKE ALL ON FUNCTION public.accept_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.accept_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_invitation(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.invitations SET status = 'declined', updated_at = now()
  WHERE id = _id AND status = 'pending' AND lower(email) = lower(auth.jwt() ->> 'email');
END $$;
REVOKE ALL ON FUNCTION public.decline_invitation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decline_invitation(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_list_offices()
RETURNS TABLE(id uuid, company_name text, city text, district text, created_at timestamptz,
  verified boolean, whatsapp_locked boolean, fal_license_no text, office_phone text,
  manager_email text, members bigint, properties bigint, units bigint, listed_publicly boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  RETURN QUERY
  SELECT o.id, o.company_name, o.city, o.district, o.created_at, o.verified, o.whatsapp_locked,
    o.fal_license_no, o.office_phone,
    (SELECT u.email::text FROM public.org_members m JOIN auth.users u ON u.id = m.user_id
      WHERE m.org_id = o.id AND m.kind = 'member' AND m.is_manager ORDER BY m.created_at LIMIT 1),
    (SELECT count(*) FROM public.org_members m WHERE m.org_id = o.id),
    (SELECT count(*) FROM public.properties p JOIN public.org_members m ON m.user_id = p.owner_id WHERE m.org_id = o.id),
    (SELECT count(*) FROM public.units un JOIN public.org_members m ON m.user_id = un.owner_id WHERE m.org_id = o.id),
    o.listed_publicly
  FROM public.org_settings o ORDER BY o.created_at;
END $$;
REVOKE ALL ON FUNCTION public.admin_list_offices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_offices() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_office_verified(_org uuid, _verified boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  UPDATE public.org_settings SET verified = COALESCE(_verified, false), updated_at = now() WHERE id = _org;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_office_verified(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_office_verified(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_office_flags(_org uuid, _whatsapp_locked boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'غير مصرح'; END IF;
  UPDATE public.org_settings SET whatsapp_locked = COALESCE(_whatsapp_locked, true), updated_at = now() WHERE id = _org;
END $$;
REVOKE ALL ON FUNCTION public.admin_set_office_flags(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_office_flags(uuid, boolean) TO authenticated;

DROP VIEW IF EXISTS public.vacant_unit_photos_public;
DROP VIEW IF EXISTS public.owner_pages_public;
DROP VIEW IF EXISTS public.office_pages_public;
DROP VIEW IF EXISTS public.vacant_units_public;

CREATE VIEW public.vacant_units_public WITH (security_invoker = true) AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp
FROM public.units u
JOIN public.org_members m ON m.user_id = u.owner_id AND m.kind = 'member'
JOIN public.org_settings o ON o.id = m.org_id AND o.listed_publicly AND o.verified
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

CREATE VIEW public.vacant_unit_photos_public WITH (security_invoker = true) AS
SELECT ph.unit_id, ph.path, ph.position
FROM public.unit_photos ph
JOIN public.vacant_units_public v ON v.id = ph.unit_id;
GRANT SELECT ON public.vacant_unit_photos_public TO anon, authenticated;

CREATE VIEW public.owner_pages_public WITH (security_invoker = true) AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.phone, op.whatsapp,
  op.avatar_path,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op WHERE op.published;
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;

CREATE VIEW public.office_pages_public WITH (security_invoker = true) AS
SELECT o.id, o.company_name, o.logo_url, o.banner_path, o.city, o.district, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.vacant_units_public v WHERE v.office_id = o.id) AS listings_count
FROM public.org_settings o WHERE o.listed_publicly AND o.verified;
GRANT SELECT ON public.office_pages_public TO anon, authenticated;

UPDATE public.org_settings SET verified = true;

INSERT INTO public.org_members (org_id, user_id, kind, role, is_manager)
SELECT (SELECT id FROM public.org_settings ORDER BY created_at LIMIT 1), r.user_id, 'member', r.role::text, true
FROM public.user_roles r WHERE r.role IN ('admin','staff')
ON CONFLICT (org_id, user_id) DO NOTHING;
