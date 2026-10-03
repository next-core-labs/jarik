REVOKE EXECUTE ON FUNCTION public.notify_unit_staff(uuid, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_unit_staff(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.notify_unit_staff(uuid, text, text, text) TO authenticated;