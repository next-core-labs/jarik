-- المرحلة B من توسيع لوحة "المدير العام" (/hq): صلاحيتا hq_admins جديدتان ("offices" و"system" معًا
-- بهذا الترحيل لتفادي ترحيل قيد ثانٍ مطابق بمرحلة لاحقة)، دوال إدارة مكاتب خاصة بـ/hq (لا تلمس
-- admin_list_offices/admin_set_office_verified/admin_set_office_flags الأصلية المخصَّصة لـ/admin
-- عبر requireAdmin — نفس نمط ازدواج hqImpersonateStart/impersonateStart المتَّبع أصلًا بهذا الكود)،
-- وتمييز عروض بالسوق العام (units.featured) يظهر أولًا بالفرز الافتراضي.

ALTER TABLE public.hq_admins DROP CONSTRAINT hq_admins_permissions_check;
ALTER TABLE public.hq_admins ADD CONSTRAINT hq_admins_permissions_check
  CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system']::text[]);

ALTER TABLE public.hq_invitations DROP CONSTRAINT hq_invitations_permissions_check;
ALTER TABLE public.hq_invitations ADD CONSTRAINT hq_invitations_permissions_check
  CHECK (permissions <@ ARRAY['subscribers', 'accounting', 'commissions', 'reviews', 'offices', 'system']::text[]);

-- دليل المكاتب لـ/hq — مطابقة admin_list_offices تمامًا لكن بحارس صلاحية "offices" بدل دور admin.
CREATE OR REPLACE FUNCTION public.hq_list_offices()
RETURNS TABLE(
  id uuid, company_name text, city text, district text, fal_license_no text, office_phone text,
  manager_email text, whatsapp_locked boolean, listed_publicly boolean, verified boolean,
  created_at timestamptz, members bigint, properties bigint, units bigint
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'offices' = ANY(permissions)
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  RETURN QUERY
  SELECT o.id, o.company_name, o.city, o.district, o.fal_license_no, o.office_phone,
    (SELECT u.email::text FROM auth.users u
     JOIN public.org_members m ON m.user_id = u.id
     WHERE m.org_id = o.id AND m.is_manager LIMIT 1) AS manager_email,
    o.whatsapp_locked, o.listed_publicly, o.verified, o.created_at,
    (SELECT count(*) FROM public.org_members m WHERE m.org_id = o.id) AS members,
    (SELECT count(*) FROM public.properties p WHERE p.org_id = o.id) AS properties,
    (SELECT count(*) FROM public.units un JOIN public.properties p ON p.id = un.property_id
     WHERE p.org_id = o.id) AS units
  FROM public.org_settings o
  ORDER BY o.created_at DESC;
END $$;
REVOKE ALL ON FUNCTION public.hq_list_offices() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_list_offices() TO authenticated;

CREATE OR REPLACE FUNCTION public.hq_set_office_verified(_org uuid, _verified boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'offices' = ANY(permissions)
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.org_settings SET verified = COALESCE(_verified, false), updated_at = now() WHERE id = _org;
END $$;
REVOKE ALL ON FUNCTION public.hq_set_office_verified(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_set_office_verified(uuid, boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.hq_set_office_flags(_org uuid, _whatsapp_locked boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'offices' = ANY(permissions)
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.org_settings SET whatsapp_locked = COALESCE(_whatsapp_locked, true), updated_at = now() WHERE id = _org;
END $$;
REVOKE ALL ON FUNCTION public.hq_set_office_flags(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_set_office_flags(uuid, boolean) TO authenticated;

-- تمييز عروض بالسوق العام.
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS featured_at timestamptz;

CREATE OR REPLACE FUNCTION public.hq_set_unit_featured(_unit uuid, _featured boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'super_admin')
    OR EXISTS (
      SELECT 1 FROM public.hq_admins WHERE user_id = auth.uid() AND 'offices' = ANY(permissions)
    )
  ) THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;
  UPDATE public.units
  SET featured = COALESCE(_featured, false), featured_at = CASE WHEN _featured THEN now() ELSE NULL END
  WHERE id = _unit;
END $$;
REVOKE ALL ON FUNCTION public.hq_set_unit_featured(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_set_unit_featured(uuid, boolean) TO authenticated;

-- نفس تعريف vacant_units_public الحالي (20260926030558) + عمود featured فقط — بلا أي تغيير آخر.
CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp,
  round(p.lat::numeric, 2) AS lat, round(p.lng::numeric, 2) AS lng,
  u.featured
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = COALESCE(
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id AND m.kind = 'member' LIMIT 1),
  (SELECT m.org_id FROM public.org_members m WHERE m.user_id = u.owner_id LIMIT 1),
  (SELECT s.id FROM public.org_settings s WHERE s.listed_publicly AND s.verified ORDER BY s.created_at LIMIT 1)
)
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published
WHERE u.status = 'vacant' AND u.market_listed;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;
