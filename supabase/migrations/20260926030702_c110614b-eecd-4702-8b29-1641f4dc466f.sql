ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES public.org_settings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS audit_log_org_idx ON public.audit_log (org_id);