-- حماية من إعادة تشغيل (replay) رسالة واتساب واردة — معرّف الرسالة من المزوّد (Meta message id أو
-- Twilio MessageSid) يُخزَّن الآن، وفهرس فريد يمنع إدراج نفس (channel_id, provider_message_id) مرتين.
-- رسائل بلا معرّف (مزوّد لا يرسله) تبقى بلا حماية replay — القيد يتجاهل provider_message_id الفارغ
-- عمدًا بدل رفض الإدراج.
ALTER TABLE public.whatsapp_messages ADD COLUMN IF NOT EXISTS provider_message_id text;
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_channel_provider_msg_idx
  ON public.whatsapp_messages (channel_id, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
