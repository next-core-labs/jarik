CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  kind text NOT NULL DEFAULT 'info',
  source text NOT NULL DEFAULT 'system',
  related_table text,
  related_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_read" ON public.notifications FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "notifications_insert" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
CREATE POLICY "notifications_update" ON public.notifications FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR public.is_staff(auth.uid()))
  WITH CHECK (user_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "notifications_delete" ON public.notifications FOR DELETE TO authenticated
  USING (public.is_staff(auth.uid()));
CREATE INDEX notifications_user_idx ON public.notifications (user_id, created_at DESC);

CREATE TABLE public.whatsapp_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  office_name text NOT NULL,
  phone text NOT NULL,
  provider text NOT NULL DEFAULT 'meta',
  verify_token text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phone)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_channels TO authenticated;
GRANT ALL ON public.whatsapp_channels TO service_role;
ALTER TABLE public.whatsapp_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_channels_read" ON public.whatsapp_channels FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY "wa_channels_manage" ON public.whatsapp_channels FOR ALL TO authenticated
  USING (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (owner_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER t12 BEFORE UPDATE ON public.whatsapp_channels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.whatsapp_messages
  ADD COLUMN channel_id uuid REFERENCES public.whatsapp_channels(id) ON DELETE SET NULL,
  ADD COLUMN sender_role text,
  ADD COLUMN suggested_reply text,
  ADD COLUMN notification_id uuid REFERENCES public.notifications(id) ON DELETE SET NULL;
CREATE POLICY "wa_messages_insert" ON public.whatsapp_messages FOR INSERT TO authenticated
  WITH CHECK (public.is_staff(auth.uid()));
GRANT INSERT ON public.whatsapp_messages TO authenticated;

ALTER TABLE public.org_settings
  ADD COLUMN ejar_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN ejar_broker_id text,
  ADD COLUMN ejar_last_sync timestamptz;

ALTER TABLE public.invoices ADD COLUMN description text;