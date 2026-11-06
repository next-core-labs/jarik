-- QA 2026-11-05 (vendor P1): the assigned technician could change only a job's status and visit
-- time (guard_maintenance_columns), so "إنجاز" closed every job with cost 0 and no word on what was
-- done. Product decision: a technician records the cost and a note for their own jobs from /portal.
-- Everything else stays blocked for them. Forward-only.

-- 1) Where the technician's note lives. maintenance_requests had no notes column: description is
--    the tenant's text, approval_note the owner's decision, rating_note the tenant's review.
ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS technician_note text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_technician_note_len') THEN
    ALTER TABLE public.maintenance_requests ADD CONSTRAINT maintenance_technician_note_len
      CHECK (technician_note IS NULL OR length(technician_note) <= 1000);
  END IF;
END $$;

-- 2) guard_maintenance_columns: body from 20260924131434 (the newest), with two changes:
--    - INSERT: a tenant's new request starts with no technician note, like the other office fields.
--    - UPDATE by the job's assigned technician (OLD.technician_id = auth.uid()): besides status and
--      visit time, cost and technician_note, while the job is still open. The cost must be 0 or
--      more; approval follows it as on the office screen (maintenance.tsx saveCost): above the cap
--      (active agreement's cap, else the office threshold, else 2000) on a unit with an owner it
--      goes back to the owner as 'pending'; within the cap it needs none, except that an owner's
--      approval or rejection is kept (a technician cannot undo a rejection by lowering the cost).
--      zz_owner_auto_approve still runs after this and auto-approves within the owner's limit.
--    Every other non-staff UPDATE keeps the old rule (status and visit time only), and a technician
--    still cannot touch approval_status, technician_id, unit, rating or any other column.
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
    NEW.technician_note := NULL;
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

  -- The job's assigned technician: status, visit time, and while the job is open its cost and note.
  IF OLD.technician_id = auth.uid() THEN
    IF (to_jsonb(NEW) - 'status' - 'scheduled_at' - 'cost' - 'technician_note' - 'updated_at')
       IS DISTINCT FROM
       (to_jsonb(OLD) - 'status' - 'scheduled_at' - 'cost' - 'technician_note' - 'updated_at') THEN
      RAISE EXCEPTION 'يمكن للفني تحديث الحالة وموعد الزيارة والتكلفة والملاحظة فقط' USING ERRCODE = '42501';
    END IF;
    IF NEW.cost IS DISTINCT FROM OLD.cost OR NEW.technician_note IS DISTINCT FROM OLD.technician_note THEN
      IF OLD.status IN ('done', 'cancelled') THEN
        RAISE EXCEPTION 'الطلب مغلق — لا يمكن تعديل التكلفة أو الملاحظة' USING ERRCODE = '42501';
      END IF;
      IF NEW.cost IS NULL OR NEW.cost < 0 THEN
        RAISE EXCEPTION 'التكلفة رقم بالريال، ٠ أو أكثر' USING ERRCODE = '23514';
      END IF;
      IF length(coalesce(NEW.technician_note, '')) > 1000 THEN
        RAISE EXCEPTION 'الملاحظة طويلة جدًا — ١٠٠٠ حرف كحد أقصى' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF NEW.cost IS DISTINCT FROM OLD.cost THEN
      IF private.unit_owner(NEW.unit_id) IS NOT NULL
         AND NEW.cost > COALESCE(public.effective_maintenance_cap(NEW.unit_id, NEW.org_id), 2000) THEN
        NEW.approval_status := 'pending';
      ELSIF OLD.approval_status IN ('pending', 'not_required') THEN
        NEW.approval_status := 'not_required';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Any other non-staff UPDATE: status and visit time only.
  IF (to_jsonb(NEW) - 'status' - 'scheduled_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'scheduled_at' - 'updated_at') THEN
    RAISE EXCEPTION 'يمكن للفني تحديث حالة الطلب وموعد الزيارة فقط' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_maintenance_columns() FROM PUBLIC, anon, authenticated;
