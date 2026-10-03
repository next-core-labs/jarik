DROP POLICY IF EXISTS "members see their org" ON public.org_members;
CREATE POLICY "members see their org" ON public.org_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR org_id = ANY (public.my_org_ids()));

REVOKE ALL ON FUNCTION public.orgs_of_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.orgs_of_user(uuid) TO service_role;