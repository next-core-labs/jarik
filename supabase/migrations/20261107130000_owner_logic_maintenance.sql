-- Owner-logic review 2026-11-07, H3: owner approval above the maintenance cap was enforced only in
-- the office UI. guard_maintenance_columns returned early for every staff write, so staff could
-- start or finish a job still waiting on the owner, wipe an owner's rejection by re-entering a cost
-- under the cap (maintenance.tsx saveCost wrote 'not_required'), or PATCH approval_status='approved'.
-- Product decision 6: only the owner decides approved/rejected; staff cost changes re-ask above the
-- cap and keep an owner's decision; a job can't leave 'new' while approval is pending or rejected
-- (cancelling stays allowed). Coordinator 2026-11-07: this holds for the technician too, and no job
-- may be finished ('done') from any status while approval is pending or rejected. Forward-only.
--
-- Body from 20261106120000 (the newest). Unchanged: the service-role / no-session path (the
-- owner's decision is written by decideMaintenanceApproval with the service role, so it still goes
-- through), the tenant INSERT and rating branches, and the technician branch and final catch-all
-- apart from the status rule below.
-- New:a staff branch instead of the bare `RETURN NEW` for staff.
--   INSERT: approval starts from the cost (pending above the cap on a unit with an owner, else
--           not_required) with no owner note; a new job above the cap can't start as in_progress/done.
--   UPDATE: approval_status may not be set to approved/rejected and approval_note may not change;
--           staff may set 'pending' (ask the owner again, e.g. after a rejection) on a unit with an
--           owner; any other direct change of approval_status is refused. A cost change follows the
--           technician rule: above the cap → 'pending'; within it → 'not_required' unless the owner
--           already approved or rejected (kept).
-- Status rule for every signed-in caller (staff, the assigned technician, anyone else), checked on
-- the approval the row ends up with (private.maintenance_status_blocked): while approval is
-- 'pending' or 'rejected' a job can't start (new/cancelled → in_progress) and can't be finished
-- (any status → done). Cancelling stays allowed. The technician branch is otherwise unchanged; it
-- only runs this check before returning.
-- zz_owner_auto_approve (BEFORE INSERT OR UPDATE OF approval_status, cost) still runs after this
-- trigger and approves a 'pending' request within the owner's own limit.

-- NULL when the move is allowed, else the Arabic reason.
CREATE OR REPLACE FUNCTION private.maintenance_status_blocked(
  _old_status text, _new_status text, _approval text
) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _approval NOT IN ('pending', 'rejected') OR _new_status IS NOT DISTINCT FROM _old_status THEN NULL
    WHEN _new_status = 'done'
      OR (_new_status = 'in_progress' AND COALESCE(_old_status, 'new') NOT IN ('in_progress', 'done'))
    THEN CASE WHEN _approval = 'pending'
           THEN 'بانتظار موافقة المالك على التكلفة — لا يبدأ العمل ولا يُنجز قبل موافقته'
           ELSE 'رفض المالك هذه التكلفة — عدّلها واطلب موافقته مجددًا، أو ألغِ الطلب' END
  END
$$;
REVOKE ALL ON FUNCTION private.maintenance_status_blocked(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.maintenance_status_blocked(text, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_maintenance_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _has_owner boolean;
  _over_cap boolean;
  _blocked text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Office staff: every column as before, except the owner's approval decision.
  IF public.is_staff(auth.uid()) THEN
    IF (TG_OP = 'INSERT' OR NEW.cost IS DISTINCT FROM OLD.cost)
       AND (NEW.cost IS NULL OR NEW.cost < 0) THEN
      RAISE EXCEPTION 'التكلفة رقم بالريال، ٠ أو أكثر' USING ERRCODE = '23514';
    END IF;
    _has_owner := NEW.unit_id IS NOT NULL AND private.unit_owner(NEW.unit_id) IS NOT NULL;
    _over_cap := _has_owner
      AND NEW.cost > COALESCE(public.effective_maintenance_cap(NEW.unit_id, NEW.org_id), 2000);

    IF TG_OP = 'INSERT' THEN
      NEW.approval_status := CASE WHEN _over_cap THEN 'pending' ELSE 'not_required' END;
      NEW.approval_note := NULL;
    ELSE
      IF NEW.approval_status IS DISTINCT FROM OLD.approval_status THEN
        IF NEW.approval_status IN ('approved', 'rejected') THEN
          RAISE EXCEPTION 'الموافقة على الصيانة أو رفضها قرار المالك وحده' USING ERRCODE = '42501';
        END IF;
        IF NEW.approval_status IS DISTINCT FROM 'pending' OR NOT _has_owner THEN
          RAISE EXCEPTION 'حالة الموافقة تتبع التكلفة — لا يمكن تغييرها مباشرة' USING ERRCODE = '42501';
        END IF;
      END IF;
      IF NEW.approval_note IS DISTINCT FROM OLD.approval_note THEN
        RAISE EXCEPTION 'ملاحظة الموافقة يكتبها المالك وحده' USING ERRCODE = '42501';
      END IF;
      IF NEW.cost IS DISTINCT FROM OLD.cost THEN
        IF _over_cap THEN
          NEW.approval_status := 'pending';
        ELSIF OLD.approval_status IN ('pending', 'not_required') THEN
          NEW.approval_status := 'not_required';
        END IF;
      END IF;
    END IF;

    _blocked := private.maintenance_status_blocked(
      CASE WHEN TG_OP = 'INSERT' THEN 'new' ELSE OLD.status END, NEW.status, NEW.approval_status);
    IF _blocked IS NOT NULL THEN
      RAISE EXCEPTION '%', _blocked USING ERRCODE = '42501';
    END IF;
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
    _blocked := private.maintenance_status_blocked(OLD.status, NEW.status, NEW.approval_status);
    IF _blocked IS NOT NULL THEN
      RAISE EXCEPTION '%', _blocked USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Any other non-staff UPDATE: status and visit time only.
  IF (to_jsonb(NEW) - 'status' - 'scheduled_at' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'status' - 'scheduled_at' - 'updated_at') THEN
    RAISE EXCEPTION 'يمكن للفني تحديث حالة الطلب وموعد الزيارة فقط' USING ERRCODE = '42501';
  END IF;
  _blocked := private.maintenance_status_blocked(OLD.status, NEW.status, NEW.approval_status);
  IF _blocked IS NOT NULL THEN
    RAISE EXCEPTION '%', _blocked USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION public.guard_maintenance_columns() FROM PUBLIC, anon, authenticated;
