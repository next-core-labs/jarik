DROP POLICY IF EXISTS "members see their org" ON public.org_members;
CREATE POLICY "members see their org" ON public.org_members
FOR SELECT TO authenticated
USING (user_id = auth.uid() OR org_id = ANY (public.orgs_of_user(auth.uid())));