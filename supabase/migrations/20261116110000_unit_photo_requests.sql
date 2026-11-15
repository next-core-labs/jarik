-- «طلب تصوير»: an office asks Jarak's team to photograph a unit. The request reaches the platform
-- (the system admin and HQ admins with the `offices` permission — «المكاتب والسوق»), who schedule it,
-- mark it done or cancel it; the office is told at each step.

CREATE TABLE IF NOT EXISTS public.unit_photo_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'scheduled', 'done', 'cancelled')),
  scheduled_for timestamptz,
  hq_note text CHECK (hq_note IS NULL OR char_length(hq_note) <= 500),
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- One open request per unit: a second click doesn't book the photographer twice.
CREATE UNIQUE INDEX IF NOT EXISTS unit_photo_requests_one_open
  ON public.unit_photo_requests (unit_id) WHERE status IN ('new', 'scheduled');
CREATE INDEX IF NOT EXISTS unit_photo_requests_org_idx ON public.unit_photo_requests (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS unit_photo_requests_status_idx ON public.unit_photo_requests (status, created_at);

ALTER TABLE public.unit_photo_requests ENABLE ROW LEVEL SECURITY;
-- Written only through the functions below; the office's team reads its own office's requests.
REVOKE ALL ON public.unit_photo_requests FROM anon, authenticated;
GRANT SELECT ON public.unit_photo_requests TO authenticated;
GRANT ALL ON public.unit_photo_requests TO service_role;
DROP POLICY IF EXISTS unit_photo_requests_office_read ON public.unit_photo_requests;
CREATE POLICY unit_photo_requests_office_read ON public.unit_photo_requests FOR SELECT TO authenticated
  USING (
    public.is_staff(auth.uid())
    AND EXISTS (SELECT 1 FROM public.org_members m
                WHERE m.org_id = unit_photo_requests.org_id AND m.user_id = auth.uid() AND m.kind = 'member')
  );

-- Who handles them on the platform.
CREATE OR REPLACE FUNCTION private.is_hq_offices(_uid uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_uid, 'super_admin')
      OR EXISTS (SELECT 1 FROM public.hq_admins h WHERE h.user_id = _uid AND 'offices' = ANY(h.permissions))
$$;
REVOKE ALL ON FUNCTION private.is_hq_offices(uuid) FROM PUBLIC, anon, authenticated;

-- ── The office asks ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_unit_photos(_unit_id uuid, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_id uuid;
  v_label text;
  v_office text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذه العملية لموظفي المكتب فقط' USING ERRCODE = '42501';
  END IF;
  -- The unit's office (its property's, or the office managing an owner's unit by agreement), and
  -- the caller must be on that office's team.
  SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id)),
         concat_ws(' · ', p.name, COALESCE(NULLIF(u.unit_name, ''), 'وحدة ' || u.unit_number), u.district)
  INTO v_org, v_label
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = _unit_id;
  IF v_org IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.org_members m WHERE m.org_id = v_org AND m.user_id = auth.uid() AND m.kind = 'member'
  ) THEN
    RAISE EXCEPTION 'الوحدة لا يديرها مكتبك' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.unit_photo_requests r
             WHERE r.unit_id = _unit_id AND r.status IN ('new', 'scheduled')) THEN
    RAISE EXCEPTION 'لهذه الوحدة طلب تصوير قيد المعالجة' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.unit_photo_requests (unit_id, org_id, requested_by, notes)
  VALUES (_unit_id, v_org, auth.uid(), NULLIF(btrim(COALESCE(_notes, '')), ''))
  RETURNING id INTO v_id;

  SELECT o.company_name INTO v_office FROM public.org_settings o WHERE o.id = v_org;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id, link)
  SELECT staff.user_id, v_org, 'طلب تصوير جديد',
         'مكتب «' || COALESCE(NULLIF(btrim(v_office), ''), '—') || '» يطلب تصوير ' || v_label || '.',
         'system', 'system', 'unit_photo_requests', v_id, '/hq'
  FROM (
    SELECT r.user_id FROM public.user_roles r WHERE r.role = 'super_admin'
    UNION
    SELECT h.user_id FROM public.hq_admins h WHERE 'offices' = ANY(h.permissions)
  ) staff;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.request_unit_photos(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_unit_photos(uuid, text) TO authenticated;

-- ── The platform's list ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_photo_requests()
RETURNS TABLE (
  id uuid, status text, notes text, hq_note text, scheduled_for timestamptz, created_at timestamptz,
  unit_id uuid, unit_label text, district text, city text, lat numeric, lng numeric,
  office_name text, office_phone text, requested_by_name text, requested_by_phone text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT private.is_hq_offices(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.id, r.status, r.notes, r.hq_note, r.scheduled_for, r.created_at,
    u.id, concat_ws(' · ', p.name, COALESCE(NULLIF(u.unit_name, ''), 'وحدة ' || u.unit_number)),
    COALESCE(NULLIF(u.district, ''), p.district), p.city,
    round(p.lat::numeric, 5), round(p.lng::numeric, 5),
    o.company_name, o.office_phone, pr.full_name, pr.phone
  FROM public.unit_photo_requests r
  JOIN public.units u ON u.id = r.unit_id
  JOIN public.properties p ON p.id = u.property_id
  JOIN public.org_settings o ON o.id = r.org_id
  LEFT JOIN public.profiles pr ON pr.id = r.requested_by
  ORDER BY (r.status IN ('new', 'scheduled')) DESC, r.created_at DESC
  LIMIT 300;
END $$;
REVOKE ALL ON FUNCTION public.hq_photo_requests() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_photo_requests() TO authenticated;

-- ── The platform moves a request on, and the office hears about it ──────────────────────────────
CREATE OR REPLACE FUNCTION public.hq_set_photo_request(
  _id uuid, _status text, _scheduled_for timestamptz DEFAULT NULL, _note text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; v_label text;
BEGIN
  IF NOT private.is_hq_offices(auth.uid()) THEN
    RAISE EXCEPTION 'غير مصرح' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('scheduled', 'done', 'cancelled') THEN
    RAISE EXCEPTION 'حالة غير صالحة' USING ERRCODE = '22023';
  END IF;
  IF _status = 'scheduled' AND _scheduled_for IS NULL THEN
    RAISE EXCEPTION 'حدّد موعد التصوير' USING ERRCODE = '22023';
  END IF;
  UPDATE public.unit_photo_requests
  SET status = _status,
      scheduled_for = CASE WHEN _status = 'scheduled' THEN _scheduled_for ELSE scheduled_for END,
      hq_note = COALESCE(NULLIF(btrim(COALESCE(_note, '')), ''), hq_note),
      handled_by = auth.uid(), updated_at = now()
  WHERE id = _id AND status IN ('new', 'scheduled')
  RETURNING * INTO r;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'الطلب غير موجود أو أُغلق' USING ERRCODE = '02000';
  END IF;

  SELECT concat_ws(' · ', p.name, COALESCE(NULLIF(u.unit_name, ''), 'وحدة ' || u.unit_number))
  INTO v_label FROM public.units u JOIN public.properties p ON p.id = u.property_id WHERE u.id = r.unit_id;
  PERFORM private.notify_org_staff(
    r.org_id,
    CASE _status WHEN 'scheduled' THEN 'موعد تصوير الوحدة' WHEN 'done' THEN 'تم تصوير الوحدة'
                 ELSE 'أُلغي طلب التصوير' END,
    v_label || CASE _status
      WHEN 'scheduled' THEN ' — الموعد: ' || to_char(_scheduled_for AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD HH24:MI')
      WHEN 'done' THEN ' — ستصلك الصور قريبًا.'
      ELSE '' END
      || COALESCE(' — ' || NULLIF(btrim(COALESCE(_note, '')), ''), ''),
    'unit', 'units', r.unit_id);
END $$;
REVOKE ALL ON FUNCTION public.hq_set_photo_request(uuid, text, timestamptz, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hq_set_photo_request(uuid, text, timestamptz, text) TO authenticated;
