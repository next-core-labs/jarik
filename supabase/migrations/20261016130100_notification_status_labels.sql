-- Notifications and unit updates showed raw status keys ("الحالة: in_progress"). Map them to the
-- Arabic labels the UI uses (src/lib/format.ts maintenanceStatusLabel / unitStatusLabel). An
-- unknown key still falls back to the raw value, as the UI does.

CREATE OR REPLACE FUNCTION private.maintenance_status_label(_status text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _status
    WHEN 'new' THEN 'جديد'
    WHEN 'in_progress' THEN 'جاري'
    WHEN 'done' THEN 'منجز'
    WHEN 'cancelled' THEN 'ملغي'
    ELSE _status END
$$;

CREATE OR REPLACE FUNCTION private.unit_status_label(_status text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _status
    WHEN 'vacant' THEN 'شاغرة'
    WHEN 'occupied' THEN 'مشغولة'
    WHEN 'maintenance' THEN 'تحت الصيانة'
    WHEN 'sold' THEN 'مباعة'
    ELSE _status END
$$;

REVOKE ALL ON FUNCTION private.maintenance_status_label(text), private.unit_status_label(text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.maintenance_status_label(text), private.unit_status_label(text)
  TO authenticated, service_role;

-- Same body as the live definition (20260920073023), with the label instead of the key.
CREATE OR REPLACE FUNCTION public.on_maintenance_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status) THEN
    PERFORM public.notify_unit(NEW.unit_id, 'تحديث طلب صيانة: ' || NEW.title,
      'الحالة: ' || private.maintenance_status_label(NEW.status), 'maintenance');
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.on_unit_changed() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.notify_unit(NEW.id, 'تحديث حالة الوحدة ' || NEW.unit_number,
      'الحالة الجديدة: ' || private.unit_status_label(NEW.status), 'unit');
  ELSIF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent THEN
    PERFORM public.notify_unit(NEW.id, 'تحديث إيجار الوحدة ' || NEW.unit_number,
      'الإيجار السنوي الجديد: ' || to_char(NEW.annual_rent, 'FM999999999.00') || ' ريال', 'unit');
  END IF;
  RETURN NEW;
END; $$;

-- Relabel rows these triggers already wrote. Exact-body matches only, so nothing else is touched.
UPDATE public.notifications
SET body = 'الحالة: ' || private.maintenance_status_label(substr(body, length('الحالة: ') + 1))
WHERE kind = 'maintenance'
  AND body IN ('الحالة: new', 'الحالة: in_progress', 'الحالة: done', 'الحالة: cancelled');

UPDATE public.unit_events
SET body = 'الحالة: ' || private.maintenance_status_label(substr(body, length('الحالة: ') + 1))
WHERE kind = 'maintenance'
  AND body IN ('الحالة: new', 'الحالة: in_progress', 'الحالة: done', 'الحالة: cancelled');

UPDATE public.notifications
SET body = 'الحالة الجديدة: ' || private.unit_status_label(substr(body, length('الحالة الجديدة: ') + 1))
WHERE kind = 'unit'
  AND body IN ('الحالة الجديدة: vacant', 'الحالة الجديدة: occupied',
               'الحالة الجديدة: maintenance', 'الحالة الجديدة: sold');

UPDATE public.unit_events
SET body = 'الحالة الجديدة: ' || private.unit_status_label(substr(body, length('الحالة الجديدة: ') + 1))
WHERE kind = 'unit'
  AND body IN ('الحالة الجديدة: vacant', 'الحالة الجديدة: occupied',
               'الحالة الجديدة: maintenance', 'الحالة الجديدة: sold');
