-- دور جديد "super_admin" (المدير العام) فوق كل شيء — منفصل تمامًا عن admin الحالي، الذي يبقى
-- مقيّدًا بمكتب واحد تحت عزل RLS متعدد المكاتب (private.staff_scope_ok). المدير العام لا يُضاف إلى
-- is_staff عمدًا: لوحته الجديدة (/hq) تحمي نفسها بكود التطبيق (requireSuperAdmin) وتقرأ عبر عميل
-- service-role، تمامًا كما تفعل /admin اليوم — بلا أي تعديل على سياسة org_isolation نفسها.
--
-- ALTER TYPE ... ADD VALUE لا يجوز استخدام القيمة الجديدة في نفس المعاملة/الملف الذي يضيفها؛ لذلك
-- إسناد الدور لحساب المالك في ترحيل منفصل (20260925150001).
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
