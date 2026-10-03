-- يمنح حساب مالك المنصة (nawafalmuhayya@gmail.com) دور المدير العام الجديد. إضافي بحت — لا يمسّ
-- أيًا من أدواره الحالية (admin/staff/owner/tenant/technician).
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'super_admin'::public.app_role
FROM auth.users
WHERE email = 'nawafalmuhayya@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;
