ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_path text;

CREATE POLICY avatars_read ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'avatars');
CREATE POLICY avatars_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_update ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text)
WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE TABLE public.direct_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_a uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_b uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_conversations_distinct_users CHECK (user_a <> user_b)
);
CREATE UNIQUE INDEX direct_conversations_pair_idx ON public.direct_conversations
  (LEAST(user_a, user_b), GREATEST(user_a, user_b));

GRANT SELECT ON public.direct_conversations TO authenticated;
GRANT ALL ON public.direct_conversations TO service_role;
ALTER TABLE public.direct_conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY direct_conversations_read ON public.direct_conversations FOR SELECT TO authenticated
USING (auth.uid() IN (user_a, user_b));

CREATE TABLE public.direct_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.direct_conversations(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sender_name text,
  body text NOT NULL CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 2000),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX direct_messages_conversation_idx ON public.direct_messages (conversation_id, created_at);

GRANT SELECT, INSERT ON public.direct_messages TO authenticated;
GRANT ALL ON public.direct_messages TO service_role;
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY direct_messages_read ON public.direct_messages FOR SELECT TO authenticated
USING (EXISTS (
  SELECT 1 FROM public.direct_conversations c
  WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b)
));
CREATE POLICY direct_messages_insert ON public.direct_messages FOR INSERT TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.direct_conversations c
    WHERE c.id = conversation_id AND auth.uid() IN (c.user_a, c.user_b)
  )
);

CREATE OR REPLACE FUNCTION public.start_direct_conversation(_code text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid(); target uuid; a uuid; b uuid; conv uuid;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'سجّل دخولك أولًا' USING ERRCODE = '42501'; END IF;
  IF NOT public.check_rate_limit('start-direct-conversation', 20, 3600) THEN
    RAISE EXCEPTION 'محاولات كثيرة — حاول لاحقًا' USING ERRCODE = '54000';
  END IF;

  SELECT id INTO target FROM public.profiles WHERE reference_code = btrim(_code);
  IF target IS NULL THEN
    RAISE EXCEPTION 'ما فيه حساب بهذا الرقم' USING ERRCODE = '22023';
  END IF;
  IF target = me THEN
    RAISE EXCEPTION 'ما تقدر تبدأ محادثة مع نفسك' USING ERRCODE = '22023';
  END IF;

  a := LEAST(me, target); b := GREATEST(me, target);
  SELECT id INTO conv FROM public.direct_conversations WHERE user_a = a AND user_b = b;
  IF conv IS NULL THEN
    INSERT INTO public.direct_conversations (user_a, user_b) VALUES (a, b) RETURNING id INTO conv;
  END IF;
  RETURN conv;
END $$;
REVOKE ALL ON FUNCTION public.start_direct_conversation(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_direct_conversation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_direct_conversations()
RETURNS TABLE(
  id uuid, other_user_id uuid, other_full_name text, last_message text, last_message_at timestamptz
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, other.id, p.full_name, lm.body, COALESCE(lm.created_at, c.created_at)
  FROM public.direct_conversations c
  JOIN LATERAL (
    SELECT CASE WHEN c.user_a = auth.uid() THEN c.user_b ELSE c.user_a END AS id
  ) other ON true
  LEFT JOIN public.profiles p ON p.id = other.id
  LEFT JOIN LATERAL (
    SELECT body, created_at FROM public.direct_messages m
    WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
  ) lm ON true
  WHERE auth.uid() IN (c.user_a, c.user_b)
  ORDER BY COALESCE(lm.created_at, c.created_at) DESC
$$;
REVOKE ALL ON FUNCTION public.my_direct_conversations() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_direct_conversations() TO authenticated;