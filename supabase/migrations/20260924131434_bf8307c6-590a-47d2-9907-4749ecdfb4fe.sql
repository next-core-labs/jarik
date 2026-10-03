-- Tenant-dashboard rebuild (2026-09-24): let a tenant rate their OWN completed maintenance
-- request ("قيّم الخدمة" in the spec). The rating/rating_note/rated_at columns have existed since
-- 20260920085713, but nothing has ever let a tenant write them:
--   1) RLS: maint_update (20260920043609) only permits UPDATE for staff or the assigned
--      technician — a tenant's UPDATE never reaches the row at all today.
--   2) The column-guard trigger (20260921090000) only lets a non-staff caller touch
--      status/scheduled_at (the technician's fields).
-- This adds one narrow allowance at each layer, forward-only (nothing existing is dropped or
-- rewritten), matching the broad-RLS-plus-narrow-trigger pattern already used for maint_insert.

-- 1) RLS: a NEW permissive policy (ORed with the existing maint_update) — broad "this is one of my
--    own tenant records' requests" check. The trigger below is what actually narrows WHAT can
--    change; this only has to admit the caller to the row.
CREATE POLICY maint_tenant_rate ON public.maintenance_requests FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.user_id = auth.uid()));

-- 2) Trigger: allow rating/rating_note only, only once (OLD.rating IS NULL), only after the
--    request is already 'done', only by the tenant who owns it. rated_at is always stamped
--    server-side here — never trusted from the client.
CREATE OR REPLACE FUNCTION public.guard_maintenance_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- A tenant may only open a request for a unit that appears in one of their own leases.
    IF NEW.unit_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.leases l
      JOIN public.tenants t ON t.id = l.tenant_id
      WHERE l.unit_id = NEW.unit_id AND t.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION 'لا يمكنك فتح طلب صيانة لوحدة ليست في عقدك' USING ERRCODE = '42501';
    END IF;
    -- Fields that belong to the office/technician/owner workflow start from their defaults.
    NEW.status := 'new';
    NEW.cost := 0;
    NEW.approval_status := 'not_required';
    NEW.approval_note := NULL;
    NEW.technician_id := NULL;
    NEW.scheduled_at := NULL;
    NEW.rating := NULL;
    NEW.rating_note := NULL;
    NEW.rated_at := NULL;
    RETURN NEW;
  END IF;

  -- The request's own tenant rating a finished job: rating + rating_note only, once, after 'done'.
  IF NEW.rating IS NOT NULL AND OLD.rating IS NULL AND OLD.status = 'done'
     AND EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = OLD.tenant_id AND t.user_id = auth.uid())
  THEN
    IF NEW.rating < 1 OR NEW.rating > 5 THEN
      RAISE EXCEPTION 'التقييم رقم بين 1 و5' USING ERRCODE = '23514';
    END IF;
    IF length(coalesce(NEW.rating_note, '')) > 500 THEN
      RAISE EXCEPTION 'ملاحظة التقييم طويلة جدًا' USING ERRCODE = '23514';
    END IF;
    IF (to_jsonb(NEW) - 'rating' - 'rating_note' - 'rated_at' - 'updated_at')
       IS DISTINCT FROM (to_jsonb(OLD) - 'rating' - 'rating_note' - 'rated_at' - 'updated_at') THEN
      RAISE EXCEPTION 'التقييم يغيّر التقييم وملاحظته فقط' USING ERRCODE = '42501';
    END IF;
    NEW.rated_at := now();
    RETURN NEW;
  END IF;

  -- UPDATE by a non-staff caller (in practice the assigned technician): status and visit time only.
  IF (to_jsonb(NEW) - 'status' - 'scheduled_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'scheduled_at' - 'updated_at') THEN
    RAISE EXCEPTION 'يمكن للفني تحديث حالة الطلب وموعد الزيارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;