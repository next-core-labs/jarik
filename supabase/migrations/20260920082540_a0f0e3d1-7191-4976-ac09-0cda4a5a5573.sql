ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS last_reminded_at timestamptz;

ALTER TABLE public.maintenance_requests ADD COLUMN IF NOT EXISTS scheduled_at timestamptz;

ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS electricity_rate numeric NOT NULL DEFAULT 0.18,
  ADD COLUMN IF NOT EXISTS water_rate numeric NOT NULL DEFAULT 6;

-- سياسة تسمح للموظفين بتحديث حقل التذكير وموعد الصيانة موجودة أصلًا عبر سياسات التحديث الحالية.

-- دالة: تقييم المستأجر من سجل سداده (عدد الدفعات المتأخرة غير المسددة)
CREATE OR REPLACE FUNCTION public.tenant_overdue_count(_tenant_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::integer
  FROM public.payments p
  JOIN public.leases l ON l.id = p.lease_id
  WHERE l.tenant_id = _tenant_id
    AND p.status <> 'paid'
    AND p.due_date < current_date;
$$;

REVOKE EXECUTE ON FUNCTION public.tenant_overdue_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_overdue_count(uuid) TO authenticated;