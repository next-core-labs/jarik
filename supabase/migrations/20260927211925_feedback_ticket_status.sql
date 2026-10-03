-- المرحلة F (الأخيرة) من توسيع لوحة "المدير العام" (/hq): platform_feedback تصير بحالة ثلاثية
-- (مفتوحة/قيد المعالجة/محلولة) بدل الثنائية الحالية (open/reviewed)، مع تسجيل من راجعها ومتى.
UPDATE public.platform_feedback SET status = 'resolved' WHERE status = 'reviewed';

ALTER TABLE public.platform_feedback DROP CONSTRAINT platform_feedback_status_check;
ALTER TABLE public.platform_feedback ADD CONSTRAINT platform_feedback_status_check
  CHECK (status IN ('open', 'in_progress', 'resolved'));

ALTER TABLE public.platform_feedback ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id);
ALTER TABLE public.platform_feedback ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- لا دالة SQL جديدة: markFeedbackReviewed الحالية بـsuper-admin.functions.ts تكتب هذا الجدول
-- بـ.update() مباشر عبر supabaseAdmin (service-role، يتجاوز RLS أصلًا — الجدول بلا أي سياسة
-- RLS لـauthenticated بتصميمه) بدل RPC، فتعميمها لحالة/reviewed_by/reviewed_at لا يحتاج شيئًا هنا
-- غير الأعمدة والقيد أعلاه.
