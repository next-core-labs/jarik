-- An account that is BOTH the unit's owner and its tenant (or an owner who also rents elsewhere)
-- wrote from the tenant dashboard and was labelled «المالك»: the sender role was always owner first.
-- The app now says which side the person writes from (unit_messages.sender_role on insert); the
-- database keeps that side only when it is true for them on this unit, and otherwise decides as
-- before. Staff of the unit's office are still «المكتب». Newest definition: 20261107110000.
CREATE OR REPLACE FUNCTION private.fill_unit_message_sender() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  asked text := NEW.sender_role;
  is_owner boolean;
  is_tenant boolean;
BEGIN
  IF uid IS NULL THEN
    RETURN NEW;
  END IF;
  NEW.sender_id := uid;
  is_owner := private.unit_owner(NEW.unit_id) = uid;
  is_tenant := private.tenant_thread_since(NEW.unit_id) IS NOT NULL;
  NEW.sender_role := CASE
    WHEN public.is_staff(uid) AND private.unit_scope_ok(NEW.unit_id, ARRAY['tenant_comms']) THEN 'staff'
    WHEN asked = 'tenant' AND is_tenant THEN 'tenant'
    WHEN asked = 'owner' AND is_owner THEN 'owner'
    WHEN is_owner THEN 'owner'
    WHEN is_tenant THEN 'tenant'
    ELSE 'unknown' END;
  NEW.sender_name := (SELECT NULLIF(btrim(p.full_name), '') FROM public.profiles p WHERE p.id = uid);
  NEW.created_at := now();
  NEW.read_at := NULL;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.fill_unit_message_sender() FROM PUBLIC, anon, authenticated;
