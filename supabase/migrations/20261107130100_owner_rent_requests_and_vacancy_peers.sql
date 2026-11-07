-- Owner-logic review 2026-11-07.
-- L9: an owner's request to change a vacant unit's rent was only a notification to the office — no
--     record, no status, no limit. Requests are now stored: one open request per unit, the owner
--     sees its status on the dashboard's vacancies panel and can withdraw it, the office marks it
--     handled or declined (and it is handled on its own once the office sets that rent, or closed
--     once the unit is no longer vacant). Every write goes through the functions below.
-- L16a: owner_vacancies() compared an owner-registered unit (property without an office) with every
--     other office-less unit on the platform — all private owners' asking rents. Peers are now units
--     of the same managing office (private.unit_office(), P2 20261107110000); a unit no office
--     manages gets no peer average.
-- Forward-only.

-- 1) The requests ---------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.owner_rent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- The office the request was sent to (the unit's office at the time); its staff answer it.
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  current_rent numeric NOT NULL,
  requested_rent numeric NOT NULL CHECK (requested_rent > 0 AND requested_rent <= 100000000),
  note text CHECK (note IS NULL OR char_length(note) <= 400),
  -- open → handled (office applied or answered it) | declined (office won't) | cancelled (owner
  -- withdrew) | closed (the unit stopped being vacant before an answer).
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'handled', 'declined', 'cancelled', 'closed')),
  reply text CHECK (reply IS NULL OR char_length(reply) <= 400),
  handled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  handled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
-- The rate limit: one open request per unit.
CREATE UNIQUE INDEX IF NOT EXISTS owner_rent_requests_open_idx
  ON public.owner_rent_requests (unit_id) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS owner_rent_requests_org_status_idx
  ON public.owner_rent_requests (org_id, status);

ALTER TABLE public.owner_rent_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.owner_rent_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.owner_rent_requests TO authenticated;
GRANT ALL ON public.owner_rent_requests TO service_role;

-- The owner who asked, and the staff of the office it was sent to. No write policies: writes go
-- through the SECURITY DEFINER functions below.
DROP POLICY IF EXISTS owner_rent_requests_read ON public.owner_rent_requests;
CREATE POLICY owner_rent_requests_read ON public.owner_rent_requests FOR SELECT TO authenticated
  USING (
    owner_id = auth.uid()
    OR (public.is_staff(auth.uid()) AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.user_id = auth.uid() AND m.org_id = owner_rent_requests.org_id AND m.kind = 'member'))
  );

-- 2) Owner: ask, withdraw ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.owner_request_rent_change(
  _unit_id uuid, _new_rent numeric, _note text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _status text;
  _rent numeric;
  _office uuid;
  _open_since timestamptz;
  _id uuid;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  SELECT u.status, u.annual_rent INTO _status, _rent
  FROM public.units u WHERE u.id = _unit_id AND private.unit_owner(u.id) = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'هذه الوحدة ليست من وحداتك' USING ERRCODE = '42501';
  END IF;
  IF _status IS DISTINCT FROM 'vacant' THEN
    RAISE EXCEPTION 'الوحدة ليست شاغرة' USING ERRCODE = '23514';
  END IF;
  IF _new_rent IS NULL OR _new_rent <= 0 OR _new_rent > 100000000 THEN
    RAISE EXCEPTION 'الإيجار السنوي رقم أكبر من صفر' USING ERRCODE = '23514';
  END IF;
  IF round(_new_rent) = round(COALESCE(_rent, 0)) THEN
    RAISE EXCEPTION 'هذا هو الإيجار الحالي للوحدة' USING ERRCODE = '23514';
  END IF;
  _office := private.unit_office(_unit_id);
  IF _office IS NULL THEN
    RAISE EXCEPTION 'لا يدير هذه الوحدة مكتب — عدّل إيجارها من صفحة عقاراتك' USING ERRCODE = '23514';
  END IF;
  SELECT r.created_at INTO _open_since
  FROM public.owner_rent_requests r WHERE r.unit_id = _unit_id AND r.status = 'open';
  IF FOUND THEN
    RAISE EXCEPTION 'لديك طلب مفتوح لهذه الوحدة منذ % — انتظر رد المكتب أو اسحبه أولًا',
      to_char(_open_since AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') USING ERRCODE = '23505';
  END IF;

  BEGIN
    INSERT INTO public.owner_rent_requests (unit_id, owner_id, org_id, current_rent, requested_rent, note)
    VALUES (_unit_id, _uid, _office, COALESCE(_rent, 0), round(_new_rent),
            NULLIF(left(trim(COALESCE(_note, '')), 400), ''))
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'لديك طلب مفتوح لهذه الوحدة — انتظر رد المكتب أو اسحبه أولًا' USING ERRCODE = '23505';
  END;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.owner_cancel_rent_request(_request_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  UPDATE public.owner_rent_requests
  SET status = 'cancelled', updated_at = now()
  WHERE id = _request_id AND owner_id = auth.uid() AND status = 'open';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'لا يوجد طلب مفتوح بهذا الرقم' USING ERRCODE = 'P0002';
  END IF;
END $$;

-- 3) Office: mark handled or declined --------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.staff_resolve_rent_request(
  _request_id uuid, _status text, _reply text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.owner_rent_requests%ROWTYPE;
  _label text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'هذا الإجراء لموظفي المكتب' USING ERRCODE = '42501';
  END IF;
  IF _status NOT IN ('handled', 'declined') THEN
    RAISE EXCEPTION 'حالة غير معروفة' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO _r FROM public.owner_rent_requests WHERE id = _request_id FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.user_id = auth.uid() AND m.org_id = _r.org_id AND m.kind = 'member'
  ) THEN
    RAISE EXCEPTION 'لم نجد الطلب في مكتبك' USING ERRCODE = '42501';
  END IF;
  IF _r.status <> 'open' THEN
    RAISE EXCEPTION 'عولج هذا الطلب مسبقًا' USING ERRCODE = '23514';
  END IF;

  UPDATE public.owner_rent_requests
  SET status = _status, reply = NULLIF(left(trim(COALESCE(_reply, '')), 400), ''),
      handled_by = auth.uid(), handled_at = now(), updated_at = now()
  WHERE id = _request_id;

  SELECT 'وحدة ' || u.unit_number INTO _label FROM public.units u WHERE u.id = _r.unit_id;
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  VALUES (
    _r.owner_id, _r.org_id,
    CASE WHEN _status = 'handled' THEN 'عالج المكتب طلب تعديل إيجار ' ELSE 'اعتذر المكتب عن طلب تعديل إيجار ' END
      || COALESCE(_label, 'وحدتك'),
    'طلبت ' || trim(to_char(_r.requested_rent, 'FM999G999G990')) || ' ر.س سنويًا'
      || COALESCE(' — ' || NULLIF(left(trim(COALESCE(_reply, '')), 400), ''), ''),
    'unit', 'system', 'owner_rent_requests', _r.id
  );
END $$;

-- 4) Keep requests in step with the unit -----------------------------------------------------------
-- The office applying the requested rent answers the request; a unit that is no longer vacant
-- closes it (nothing left to price), so a stale request never blocks the next one.
CREATE OR REPLACE FUNCTION private.sync_owner_rent_requests() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _r public.owner_rent_requests%ROWTYPE;
BEGIN
  IF NEW.status IS DISTINCT FROM 'vacant' THEN
    UPDATE public.owner_rent_requests SET status = 'closed', updated_at = now()
    WHERE unit_id = NEW.id AND status = 'open';
    RETURN NULL;
  END IF;
  IF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent THEN
    UPDATE public.owner_rent_requests
    SET status = 'handled', handled_by = auth.uid(), handled_at = now(), updated_at = now()
    WHERE unit_id = NEW.id AND status = 'open' AND requested_rent = round(NEW.annual_rent)
    RETURNING * INTO _r;
    IF FOUND THEN
      INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
      VALUES (
        _r.owner_id, _r.org_id,
        'طبّق المكتب الإيجار الذي طلبته لوحدة ' || NEW.unit_number,
        'الإيجار المطلوب الآن ' || trim(to_char(_r.requested_rent, 'FM999G999G990')) || ' ر.س سنويًا',
        'unit', 'system', 'owner_rent_requests', _r.id
      );
    END IF;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS owner_rent_requests_sync ON public.units;
CREATE TRIGGER owner_rent_requests_sync
  AFTER UPDATE OF status, annual_rent ON public.units
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status OR OLD.annual_rent IS DISTINCT FROM NEW.annual_rent)
  EXECUTE FUNCTION private.sync_owner_rent_requests();

-- 5) owner_vacancies: peers within the same managing office, plus the unit's latest rent request ----
-- Body from 20261008120000 (the newest). Changed: peers are matched on private.unit_office() of
-- both units instead of properties.org_id (NULL matched every private owner's units); new columns
-- for the latest request (open, or answered in the last 30 days). The return type changes, so the
-- function is dropped and recreated with the same grants.
DROP FUNCTION IF EXISTS public.owner_vacancies();
CREATE FUNCTION public.owner_vacancies()
RETURNS TABLE(
  unit_id uuid, vacant_since timestamptz, market_listed boolean, publicly_listed boolean,
  photos_count bigint, peer_avg_rent numeric, peer_units bigint,
  rent_request_id uuid, rent_request_status text, rent_request_rent numeric,
  rent_request_at timestamptz, rent_request_reply text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id, u.vacant_since::timestamptz, u.market_listed,
         EXISTS (SELECT 1 FROM public.vacant_units_public v WHERE v.id = u.id),
         (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id),
         CASE WHEN peers.n >= 3 THEN round(peers.avg_rent) END,
         peers.n,
         rr.id, rr.status, rr.requested_rent, rr.created_at, rr.reply
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  CROSS JOIN LATERAL (SELECT private.unit_office(u.id) AS id) office
  LEFT JOIN LATERAL (
    SELECT count(*) AS n, avg(u2.annual_rent) AS avg_rent
    FROM public.units u2 JOIN public.properties p2 ON p2.id = u2.property_id
    WHERE office.id IS NOT NULL
      AND u2.id <> u.id AND u2.listing_purpose <> 'sale' AND u2.annual_rent > 0
      AND u2.unit_type = u.unit_type
      AND COALESCE(NULLIF(u2.district, ''), p2.district) = COALESCE(NULLIF(u.district, ''), p.district)
      AND private.unit_office(u2.id) = office.id
  ) peers ON true
  LEFT JOIN LATERAL (
    SELECT r.id, r.status, r.requested_rent, r.created_at, r.reply
    FROM public.owner_rent_requests r
    WHERE r.unit_id = u.id AND r.owner_id = auth.uid()
      AND (r.status = 'open'
           OR (r.status IN ('handled', 'declined') AND r.updated_at > now() - interval '30 days'))
    ORDER BY r.created_at DESC LIMIT 1
  ) rr ON true
  WHERE auth.uid() IS NOT NULL AND u.status = 'vacant'
    AND COALESCE(u.owner_id, p.owner_id) = auth.uid()
$$;

DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.owner_vacancies()',
    'public.owner_request_rent_change(uuid, numeric, text)',
    'public.owner_cancel_rent_request(uuid)',
    'public.staff_resolve_rent_request(uuid, text, text)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', fn);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION private.sync_owner_rent_requests() FROM PUBLIC, anon, authenticated;
