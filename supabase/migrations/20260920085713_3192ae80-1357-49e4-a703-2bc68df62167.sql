-- 1) property documents
CREATE TABLE public.property_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'deed',
  title text NOT NULL,
  doc_number text,
  file_path text,
  expires_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_documents TO authenticated;
GRANT ALL ON public.property_documents TO service_role;
ALTER TABLE public.property_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY docs_read ON public.property_documents FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid())
);
CREATE POLICY docs_write ON public.property_documents FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER t_property_documents_updated BEFORE UPDATE ON public.property_documents
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2) attribution + tenant transfer reference
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS collected_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transfer_reference text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS transfer_submitted_at timestamptz;

-- 3) maintenance approval + rating
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'not_required';
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS approval_note text;
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS rating smallint;
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS rating_note text;
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS rated_at timestamptz;

-- 4) org threshold
ALTER TABLE public.org_settings ADD COLUMN IF NOT EXISTS owner_approval_threshold numeric NOT NULL DEFAULT 2000;

-- 5) owner ROI per property
CREATE OR REPLACE FUNCTION public.owner_property_roi()
RETURNS TABLE(property_id uuid, property_name text, units_count bigint, collected numeric, expenses numeric, net numeric, roi_pct numeric)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
  SELECT p.id,
         p.name,
         count(DISTINCT u.id) AS units_count,
         COALESCE((SELECT sum(pay.amount) FROM public.payments pay
                    JOIN public.leases l ON l.id = pay.lease_id
                    JOIN public.units uu ON uu.id = l.unit_id
                   WHERE uu.property_id = p.id AND pay.status = 'paid'), 0) AS collected,
         COALESCE((SELECT sum(e.amount) FROM public.expenses e WHERE e.property_id = p.id), 0) AS expenses,
         COALESCE((SELECT sum(pay.amount) FROM public.payments pay
                    JOIN public.leases l ON l.id = pay.lease_id
                    JOIN public.units uu ON uu.id = l.unit_id
                   WHERE uu.property_id = p.id AND pay.status = 'paid'), 0)
         - COALESCE((SELECT sum(e.amount) FROM public.expenses e WHERE e.property_id = p.id), 0) AS net,
         CASE WHEN COALESCE(sum(u.annual_rent), 0) = 0 THEN 0
              ELSE round(100.0 * (
                COALESCE((SELECT sum(pay.amount) FROM public.payments pay
                           JOIN public.leases l ON l.id = pay.lease_id
                           JOIN public.units uu ON uu.id = l.unit_id
                          WHERE uu.property_id = p.id AND pay.status = 'paid'), 0)
                - COALESCE((SELECT sum(e.amount) FROM public.expenses e WHERE e.property_id = p.id), 0)
              ) / sum(u.annual_rent), 1) END AS roi_pct
  FROM public.properties p
  LEFT JOIN public.units u ON u.property_id = p.id
  GROUP BY p.id, p.name
  ORDER BY 6 DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.owner_property_roi() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_property_roi() TO authenticated;

-- 6) expiring lease alerts
CREATE OR REPLACE FUNCTION public.notify_expiring_leases(_days integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE r record; n integer := 0;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT l.unit_id, l.end_date, u.unit_number
    FROM public.leases l JOIN public.units u ON u.id = l.unit_id
    WHERE l.status = 'active'
      AND l.end_date BETWEEN current_date AND current_date + _days
  LOOP
    PERFORM public.notify_unit(r.unit_id,
      'عقد الوحدة ' || r.unit_number || ' ينتهي قريبًا',
      'تاريخ انتهاء العقد: ' || r.end_date::text, 'lease');
    n := n + 1;
  END LOOP;
  RETURN n;
END; $$;
REVOKE EXECUTE ON FUNCTION public.notify_expiring_leases(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_expiring_leases(integer) TO authenticated;