ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS unit_name text,
  ADD COLUMN IF NOT EXISTS district text,
  ADD COLUMN IF NOT EXISTS street text,
  ADD COLUMN IF NOT EXISTS floor_no text,
  ADD COLUMN IF NOT EXISTS halls integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bathrooms integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS furnished boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.repair_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  title text NOT NULL,
  vendor text,
  invoice_number text,
  amount numeric NOT NULL DEFAULT 0,
  invoice_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.repair_invoices TO authenticated;
GRANT ALL ON public.repair_invoices TO service_role;

ALTER TABLE public.repair_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY repair_invoices_read ON public.repair_invoices
FOR SELECT TO authenticated
USING (
  public.is_staff(auth.uid())
  OR private.unit_owner(unit_id) = auth.uid()
  OR private.unit_tenant_user(unit_id) = auth.uid()
);

CREATE POLICY repair_invoices_staff_write ON public.repair_invoices
FOR ALL TO authenticated
USING (public.is_staff(auth.uid()))
WITH CHECK (public.is_staff(auth.uid()));

CREATE TRIGGER t_repair_invoices_updated BEFORE UPDATE ON public.repair_invoices
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();