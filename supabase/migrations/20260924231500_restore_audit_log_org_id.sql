-- audit_log.org_id (من 20260922090000_multi_office_isolation.sql) غير موجود على القاعدة
-- المتصلة حاليًا رغم وجود org_id على جداول أخرى من نفس الترحيل (deals, maintenance_requests,
-- notifications) — انجراف مشابه لما عولج بترحيلات 24 سبتمبر الأخرى (000346/000526/000558) لجداول
-- غيرها، لكن audit_log لم يُعَد فيها. بدونه، سياسة RLS الحصرية org_isolation تخفي أي صف تدقيق
-- بلا org_id عن كل الموظفين — بما فيهم صفوف «الدخول على حساب» (IMPERSONATE) في impersonateStart.
ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS audit_log_org_idx ON public.audit_log (org_id);
