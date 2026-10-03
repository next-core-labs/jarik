DROP POLICY IF EXISTS management_agreements_read ON public.management_agreements;
CREATE POLICY management_agreements_read ON public.management_agreements FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.org_id = management_agreements.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
  )
);

DROP POLICY IF EXISTS agreement_units_read ON public.agreement_units;
CREATE POLICY agreement_units_read ON public.agreement_units FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_units.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.org_members m
             WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
           ))
  )
);

DROP POLICY IF EXISTS agreement_permissions_read ON public.agreement_permissions;
CREATE POLICY agreement_permissions_read ON public.agreement_permissions FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_permissions.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.org_members m
             WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
           ))
  )
);

DROP POLICY IF EXISTS agreement_change_requests_read ON public.agreement_change_requests;
CREATE POLICY agreement_change_requests_read ON public.agreement_change_requests FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.management_agreements a
    WHERE a.id = agreement_change_requests.agreement_id
      AND (a.owner_id = auth.uid()
           OR EXISTS (
             SELECT 1 FROM public.org_members m
             WHERE m.org_id = a.org_id AND m.user_id = auth.uid() AND m.kind = 'member'
           ))
  )
);