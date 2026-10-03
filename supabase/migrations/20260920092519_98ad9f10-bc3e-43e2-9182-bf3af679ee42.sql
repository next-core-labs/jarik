CREATE TABLE public.unit_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text,
  sender_role text NOT NULL DEFAULT 'unknown',
  body text NOT NULL,
  read_at timestamp with time zone,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.unit_messages TO authenticated;
GRANT ALL ON public.unit_messages TO service_role;

ALTER TABLE public.unit_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "unit_messages_read" ON public.unit_messages
FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR private.unit_owner(unit_id) = auth.uid()
  OR private.unit_tenant_user(unit_id) = auth.uid()
);

CREATE POLICY "unit_messages_insert" ON public.unit_messages
FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND (
    public.is_staff(auth.uid())
    OR private.unit_owner(unit_id) = auth.uid()
    OR private.unit_tenant_user(unit_id) = auth.uid()
  )
);

CREATE INDEX unit_messages_unit_created_idx ON public.unit_messages (unit_id, created_at);

CREATE TRIGGER t_unit_messages_updated BEFORE UPDATE ON public.unit_messages
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();