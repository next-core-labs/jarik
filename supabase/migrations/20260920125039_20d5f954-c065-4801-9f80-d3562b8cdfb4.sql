ALTER TABLE public.org_settings
  ADD COLUMN IF NOT EXISTS whatsapp_locked boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.org_settings.whatsapp_locked IS
  'حالة ربط واتساب: true = مقفل (يتواصل المكتب مع الإدارة لتفعيله)';

UPDATE public.org_settings SET whatsapp_locked = true WHERE whatsapp_locked IS DISTINCT FROM true;