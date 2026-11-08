-- «تنبيه الملاك والمستأجرين» on «التجديدات» said «لا توجد عقود تنتهي خلال ٩٠ يومًا» while the page
-- listed a lease: the page shows active leases ending within _days INCLUDING ones whose end date has
-- already passed without a renewal, but this function only took end_date BETWEEN today AND today+_days.
-- Now it covers every active lease the page lists, says «انتهت مدته» for the overdue ones, and
-- returns how many leases actually reached someone (an owner or tenant with an account), so the
-- screen can tell «sent» apart from «nobody to send to».
CREATE OR REPLACE FUNCTION public.notify_expiring_leases(_days integer DEFAULT 60) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record;
  n integer := 0;
  v_today date := (now() AT TIME ZONE 'Asia/Riyadh')::date;
BEGIN
  IF NOT public.is_staff(auth.uid()) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  FOR r IN
    SELECT l.unit_id, l.end_date, u.unit_number
    FROM public.leases l JOIN public.units u ON u.id = l.unit_id
    WHERE l.status = 'active'
      AND l.end_date <= v_today + _days
      AND private.org_of_unit(l.unit_id) = private.my_org()
  LOOP
    IF r.end_date < v_today THEN
      PERFORM public.notify_unit(r.unit_id,
        'عقد الوحدة ' || r.unit_number || ' انتهت مدته',
        'انتهى العقد في ' || r.end_date::text || ' ولم يُجدَّد بعد — حدّد قرارك بالتجديد أو الإخلاء.',
        'lease');
    ELSE
      PERFORM public.notify_unit(r.unit_id,
        'عقد الوحدة ' || r.unit_number || ' ينتهي قريبًا',
        'تاريخ انتهاء العقد: ' || r.end_date::text || ' — حدّد قرارك بالتجديد.',
        'lease');
    END IF;
    IF private.unit_owner(r.unit_id) IS NOT NULL OR private.unit_tenant_user(r.unit_id) IS NOT NULL THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.notify_expiring_leases(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.notify_expiring_leases(integer) TO authenticated;
