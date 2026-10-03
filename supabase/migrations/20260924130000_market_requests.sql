-- سوق الطلبات (بنمط dealapp.sa): زائر ينشر "أبحث عن..." بدون تسجيل، ويظهر للجميع — أي مكتب أو
-- مالك يتصفّحه، لا مكتب واحد فقط. هذا عكس unit_requests عمدًا (تلك خاصة بمكتب واحد يشاهدها هو
-- فقط)؛ الجدولان مستقلان تمامًا ولا يوجد تغيير على unit_requests هنا.
--
-- نموذج الخصوصية: التفاصيل العامة (النوع، الغرض، المدينة/الحي، الميزانية، الملاحظات) تظهر للجميع
-- حتى بدون تسجيل دخول — تمامًا كعروض السوق. الاسم ورقم الجوال لا يظهران إلا للموظفين المسجّلين
-- (is_staff)، عبر الجدول الأساسي مباشرة؛ الزائر العادي لا يرى بيانات تواصل صاحب الطلب إطلاقًا.
CREATE TABLE public.market_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  full_name text NOT NULL,
  phone text NOT NULL,
  purpose text NOT NULL DEFAULT 'rent' CHECK (purpose IN ('rent', 'sale')),
  unit_type text,
  city text,
  district text,
  budget_min numeric,
  budget_max numeric,
  notes text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  -- Populated only when the submitter happened to be signed in; every current submission path is
  -- anonymous/public, so this is NULL today and exists for a possible future "my requests" view.
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX market_requests_status_created_idx ON public.market_requests (status, created_at DESC);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.market_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The server function's own count-then-insert check (submitMarketRequest) is a convenience
-- fast-path for a friendly error message, but two round-trips can never be atomic on their own:
-- concurrent submissions for the same phone would each read the count before either insert
-- commits, racing past the cap. This trigger is the real, race-free enforcement — it serializes
-- concurrent inserts for the SAME phone via a transaction-scoped advisory lock before counting.
CREATE OR REPLACE FUNCTION private.enforce_market_request_rate_limit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  recent_count integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('market_requests:' || NEW.phone));
  SELECT count(*) INTO recent_count FROM public.market_requests
  WHERE phone = NEW.phone AND created_at > now() - interval '1 hour';
  IF recent_count >= 3 THEN
    RAISE EXCEPTION 'MARKET_REQUEST_RATE_LIMIT' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER enforce_rate_limit BEFORE INSERT ON public.market_requests
FOR EACH ROW EXECUTE FUNCTION private.enforce_market_request_rate_limit();

-- Known, accepted limitation (same as the pre-existing unit_requests/submitUnitRequest): the rate
-- limit keys on the caller-supplied phone string, which is format-checked only, not verified to
-- belong to the caller (no OTP). A scripted client can still flood the board with a fresh fake
-- number per request. Proper mitigation (OTP/CAPTCHA on public, unauthenticated submission) is a
-- larger change affecting both this table and unit_requests — out of scope here, not silently
-- missed.

-- Writes only via the service-role server function (rate-limited, validated) — same reasoning as
-- unit_requests: no direct anon/authenticated INSERT grant at all.
GRANT SELECT ON public.market_requests TO authenticated;
-- Column-restricted on purpose: staff may only ever flip `status` (close a request). A table-wide
-- UPDATE grant here would let any office's staff rewrite another office's request — e.g. redirect
-- the phone number to themselves to hijack a lead, or vandalize a competitor's notes/budget — since
-- the RLS policy below is deliberately row-unscoped (cross-office by design, see the SELECT policy
-- comment). Postgres enforces this at the privilege layer: a PATCH touching any other column fails
-- outright, regardless of what the RLS policy's USING/WITH CHECK would otherwise allow.
GRANT UPDATE (status) ON public.market_requests TO authenticated;
GRANT ALL ON public.market_requests TO service_role;
ALTER TABLE public.market_requests ENABLE ROW LEVEL SECURITY;

-- Full row (incl. phone/full_name) — staff only. Deliberately NOT office-scoped: this table is a
-- cross-office marketplace by design, every office's staff sees every open request, same as
-- dealapp.sa. Do not "fix" this into an org_isolation RESTRICTIVE policy later without re-reading
-- this comment — that would defeat the entire feature.
CREATE POLICY market_requests_staff_read ON public.market_requests
FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- Staff can close a request (spam, fulfilled, expired) — nothing else is ever updated by a client.
-- The column-restricted GRANT above is the real boundary; WITH CHECK re-validates row access only.
CREATE POLICY market_requests_staff_update ON public.market_requests
FOR UPDATE TO authenticated USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

-- Public-safe subset: no phone, no full_name, no created_by. Only open requests from the last 45
-- days (a simple, cron-free way to keep the board from accumulating stale leads forever).
-- Deliberately NOT `security_invoker` — see 20260924120000's lesson: a security_invoker view over
-- a table whose RLS is staff-only would return nothing for anon regardless of this WHERE clause.
-- This view intentionally bypasses market_requests' RLS; the safety boundary is the column list
-- below (no contact info), not RLS.
CREATE VIEW public.market_requests_public AS
SELECT id, created_at, purpose, unit_type, city, district, budget_min, budget_max, notes
FROM public.market_requests
WHERE status = 'open' AND created_at > now() - interval '45 days';
GRANT SELECT ON public.market_requests_public TO anon, authenticated;
