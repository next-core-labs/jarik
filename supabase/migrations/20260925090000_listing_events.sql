-- تقرير أداء الإعلان لكل وحدة: مشاهدات ونقرات اتصال/واتساب من صفحة العرض العامة، ليعرف المكتب
-- أي وحدة فعلًا تجذب اهتمامًا وأيها ما تجذب — لا يوجد أي تتبع لهذا اليوم.
CREATE TABLE public.listing_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('view', 'call_click', 'whatsapp_click')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX listing_events_unit_idx ON public.listing_events (unit_id, created_at);
CREATE INDEX listing_events_org_idx ON public.listing_events (org_id, created_at);

-- الإدراج فقط عبر server fn بصلاحية service_role (لا يوجد سبب يدخل فيه المتصفح مباشرة على
-- الجدول)، فما يحتاج أي سياسة INSERT لا للزائر ولا للموظف.
ALTER TABLE public.listing_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.listing_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.listing_events TO authenticated;
GRANT ALL ON public.listing_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.listing_events_id_seq TO service_role;

CREATE POLICY listing_events_staff_read ON public.listing_events FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

-- نفس نمط عزل المكاتب المطبّق على بقية الجداول (org_isolation) — موظف لا يرى إحصاءات مكتب آخر.
CREATE POLICY org_isolation ON public.listing_events AS RESTRICTIVE FOR ALL TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
