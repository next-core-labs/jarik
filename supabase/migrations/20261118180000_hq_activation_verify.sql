-- فصل منطق لوحة التفعيل عن حارس الصلاحية، لسببين:
--   1. التحقق: جسم plpgsql لا تُفحص استعلاماته إلا عند التنفيذ، وحارس hq_office_activation يرفع
--      «غير مصرح» قبلها لأي سياق بلا auth.uid() — فلا سبيل لإثبات أن الاستعلام يعمل قبل أن يفتح
--      فريق المنصة الشاشة ويقع على الخطأ. الدالة الخاصة تُستدعى من بلوك التحقق أسفل هذه الـmigration.
--   2. الوضوح: التصريح في مكان، والمنطق في مكان.
-- يستبدل جسم 20261118170000 بنفس التوقيع (CREATE OR REPLACE) — لا تغيير على ما تقرأه الواجهة.

CREATE OR REPLACE FUNCTION private.office_activation_rows()
RETURNS TABLE (
  id uuid, company_name text, created_at timestamptz,
  manager_email text, office_phone text, whatsapp_number text, city text, district text,
  fal_license_no text, verified boolean, listed_publicly boolean,
  units bigint, vacant bigint, vacant_priced bigint, listed bigint,
  live bigint, live_with_photos bigint,
  blocker text, priority integer
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH office_units AS (
    -- نفس عائدية الوحدة في العرض العام: عقار المكتب، أو وحدة مالك تحت اتفاقية إدارة معه.
    SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id)) AS org_id,
      u.status,
      u.market_listed,
      CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END AS price
    FROM public.units u
    JOIN public.properties p ON p.id = u.property_id
  ),
  agg AS (
    SELECT org_id,
      count(*) AS units,
      count(*) FILTER (WHERE status = 'vacant') AS vacant,
      count(*) FILTER (WHERE status = 'vacant' AND COALESCE(price, 0) > 0) AS vacant_priced,
      count(*) FILTER (WHERE status = 'vacant' AND market_listed) AS listed
    FROM office_units
    WHERE org_id IS NOT NULL
    GROUP BY org_id
  ),
  -- ما يراه الزائر فعلًا، من العرض العام نفسه لا من تخمين شروطه.
  live_now AS (
    SELECT v.office_id AS org_id,
      count(*) AS live,
      count(*) FILTER (WHERE COALESCE(v.photos_count, 0) > 0) AS live_with_photos
    FROM public.vacant_units_public v
    WHERE v.office_id IS NOT NULL
    GROUP BY v.office_id
  ),
  base AS (
    SELECT o.id, o.company_name, o.created_at,
      (SELECT au.email::text FROM auth.users au
       JOIN public.org_members m ON m.user_id = au.id
       WHERE m.org_id = o.id AND m.is_manager LIMIT 1) AS manager_email,
      o.office_phone, o.whatsapp_number, o.city, o.district,
      o.fal_license_no, o.verified, o.listed_publicly,
      COALESCE(a.units, 0) AS units,
      COALESCE(a.vacant, 0) AS vacant,
      COALESCE(a.vacant_priced, 0) AS vacant_priced,
      COALESCE(a.listed, 0) AS listed,
      COALESCE(l.live, 0) AS live,
      COALESCE(l.live_with_photos, 0) AS live_with_photos,
      -- العقبة الأولى فقط، بالأسبقية: لا يُقال «غير موثّق» لمكتب بلا وحدات أصلًا.
      CASE
        WHEN COALESCE(l.live, 0) > 0 THEN NULL
        WHEN COALESCE(a.units, 0) = 0 THEN 'no_units'
        WHEN COALESCE(a.vacant, 0) = 0 THEN 'all_occupied'
        WHEN COALESCE(a.vacant_priced, 0) = 0 THEN 'no_price'
        WHEN NOT o.verified THEN 'not_verified'
        WHEN NOT o.listed_publicly THEN 'not_listed'
        WHEN COALESCE(a.listed, 0) = 0 THEN 'not_published'
        ELSE 'other'
      END AS blocker
    FROM public.org_settings o
    LEFT JOIN agg a ON a.org_id = o.id
    LEFT JOIN live_now l ON l.org_id = o.id
  )
  SELECT b.*,
    CASE b.blocker
      WHEN 'not_verified'  THEN 1  -- توثيق المنصة بضغطة، وعروضه جاهزة → يصير حيًّا فورًا
      WHEN 'not_listed'    THEN 2  -- على المكتب تشغيل «إظهار المكتب في الدليل» بالإعدادات
      WHEN 'not_published' THEN 3  -- كل شيء جاهز، لم يضغط «نشر في الموقع»
      WHEN 'no_price'      THEN 4  -- وحدات شاغرة بلا سعر
      WHEN 'no_units'      THEN 5  -- لم يسجّل عقارات بعد
      WHEN 'all_occupied'  THEN 6  -- صحّي: كل وحداته مؤجّرة، لا شيء يُنشر
      WHEN 'other'         THEN 7
      ELSE 9                       -- ينشر فعلًا
    END::integer AS priority
  FROM base b
  ORDER BY priority, b.created_at DESC
$$;
REVOKE ALL ON FUNCTION private.office_activation_rows() FROM PUBLIC, anon, authenticated;

-- الدالة العامة: تصريح ثم تمرير. نفس التوقيع الذي تقرأه الواجهة.
CREATE OR REPLACE FUNCTION public.hq_office_activation()
RETURNS TABLE (
  id uuid, company_name text, created_at timestamptz,
  manager_email text, office_phone text, whatsapp_number text, city text, district text,
  fal_license_no text, verified boolean, listed_publicly boolean,
  units bigint, vacant bigint, vacant_priced bigint, listed bigint,
  live bigint, live_with_photos bigint,
  blocker text, priority integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_hq_offices(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT * FROM private.office_activation_rows();
END $$;
REVOKE ALL ON FUNCTION public.hq_office_activation() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_office_activation() TO authenticated;

-- ── التحقق: يُنفَّذ الاستعلام فعلًا الآن، فأي خطأ فيه يُسقط هذه الـmigration بدل أن يظهر للفريق ──
DO $$
DECLARE r record; n integer := 0; blocked integer := 0;
BEGIN
  FOR r IN SELECT * FROM private.office_activation_rows() LOOP
    n := n + 1;
    IF r.blocker IS NOT NULL THEN blocked := blocked + 1; END IF;
    RAISE NOTICE 'activation: % | units=% vacant=% priced=% listed=% live=% | blocker=% priority=%',
      COALESCE(r.company_name, '—'), r.units, r.vacant, r.vacant_priced, r.listed, r.live,
      COALESCE(r.blocker, 'active'), r.priority;
  END LOOP;
  IF n = 0 THEN
    RAISE EXCEPTION 'لوحة التفعيل لا تُرجع أي مكتب — راجع الاستعلام';
  END IF;
  RAISE NOTICE 'activation panel OK: % مكتب، % متوقف', n, blocked;
END $$;
