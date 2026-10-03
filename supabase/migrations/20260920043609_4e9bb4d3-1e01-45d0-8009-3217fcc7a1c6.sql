
CREATE TYPE public.app_role AS ENUM ('admin','staff','owner','tenant','technician');

CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  phone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE OR REPLACE FUNCTION public.is_staff(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role IN ('admin','staff'))
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'phone')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'staff')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END; $$;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE POLICY profiles_select ON public.profiles FOR SELECT TO authenticated
USING (id = auth.uid() OR public.is_staff(auth.uid()));
CREATE POLICY profiles_update ON public.profiles FOR UPDATE TO authenticated
USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE POLICY roles_select ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_staff(auth.uid()));

CREATE TABLE public.org_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name text NOT NULL DEFAULT 'شركة إدارة الأملاك',
  vat_number text,
  cr_number text,
  vat_rate numeric NOT NULL DEFAULT 15,
  address text,
  whatsapp_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.org_settings TO authenticated;
GRANT ALL ON public.org_settings TO service_role;
ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY org_read ON public.org_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY org_write ON public.org_settings FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.properties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  property_type text NOT NULL DEFAULT 'سكني',
  city text,
  district text,
  address text,
  deed_number text,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.properties TO authenticated;
GRANT ALL ON public.properties TO service_role;
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
CREATE POLICY properties_read ON public.properties FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR owner_id = auth.uid());
CREATE POLICY properties_write ON public.properties FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  unit_number text NOT NULL,
  unit_type text NOT NULL DEFAULT 'شقة',
  rooms int,
  area numeric,
  annual_rent numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'vacant',
  electricity_meter_no text,
  water_meter_no text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.units TO authenticated;
GRANT ALL ON public.units TO service_role;
ALTER TABLE public.units ENABLE ROW LEVEL SECURITY;
CREATE POLICY units_write ON public.units FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.meter_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  meter_type text NOT NULL DEFAULT 'electricity',
  reading numeric NOT NULL,
  reading_date date NOT NULL DEFAULT current_date,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.meter_readings TO authenticated;
GRANT ALL ON public.meter_readings TO service_role;
ALTER TABLE public.meter_readings ENABLE ROW LEVEL SECURITY;
CREATE POLICY readings_read ON public.meter_readings FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.id = unit_id AND p.owner_id = auth.uid()));
CREATE POLICY readings_write ON public.meter_readings FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  national_id text,
  phone text,
  email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenants TO authenticated;
GRANT ALL ON public.tenants TO service_role;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenants_read ON public.tenants FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR user_id = auth.uid());
CREATE POLICY tenants_write ON public.tenants FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.leases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  annual_rent numeric NOT NULL DEFAULT 0,
  installments int NOT NULL DEFAULT 4,
  deposit numeric NOT NULL DEFAULT 0,
  ejar_contract_no text,
  ejar_status text NOT NULL DEFAULT 'pending',
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leases TO authenticated;
GRANT ALL ON public.leases TO service_role;
ALTER TABLE public.leases ENABLE ROW LEVEL SECURITY;
CREATE POLICY leases_read ON public.leases FOR SELECT TO authenticated
USING (public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
             WHERE u.id = unit_id AND p.owner_id = auth.uid()));
CREATE POLICY leases_write ON public.leases FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE POLICY units_read ON public.units FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid()
) OR EXISTS (
  SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.unit_id = units.id AND t.user_id = auth.uid()
));

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL REFERENCES public.leases(id) ON DELETE CASCADE,
  amount numeric NOT NULL DEFAULT 0,
  due_date date NOT NULL,
  paid_date date,
  status text NOT NULL DEFAULT 'due',
  method text,
  reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY payments_read ON public.payments FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.id = lease_id AND t.user_id = auth.uid())
 OR EXISTS (SELECT 1 FROM public.leases l JOIN public.units u ON u.id = l.unit_id
  JOIN public.properties p ON p.id = u.property_id WHERE l.id = lease_id AND p.owner_id = auth.uid()));
CREATE POLICY payments_write ON public.payments FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL,
  payment_id uuid REFERENCES public.payments(id) ON DELETE SET NULL,
  lease_id uuid REFERENCES public.leases(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_vat_number text,
  seller_name text,
  seller_vat_number text,
  issue_date timestamptz NOT NULL DEFAULT now(),
  subtotal numeric NOT NULL DEFAULT 0,
  vat_amount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  qr_payload text,
  zatca_status text NOT NULL DEFAULT 'draft',
  zatca_uuid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.invoices TO authenticated;
GRANT ALL ON public.invoices TO service_role;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY invoices_read ON public.invoices FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.leases l JOIN public.tenants t ON t.id = l.tenant_id
  WHERE l.id = lease_id AND t.user_id = auth.uid()));
CREATE POLICY invoices_write ON public.invoices FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'صيانة',
  amount numeric NOT NULL DEFAULT 0,
  expense_date date NOT NULL DEFAULT current_date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY expenses_read ON public.expenses FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR EXISTS (
  SELECT 1 FROM public.properties p WHERE p.id = property_id AND p.owner_id = auth.uid()));
CREATE POLICY expenses_write ON public.expenses FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.maintenance_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'new',
  technician_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  cost numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'app',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.maintenance_requests TO authenticated;
GRANT ALL ON public.maintenance_requests TO service_role;
ALTER TABLE public.maintenance_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY maint_read ON public.maintenance_requests FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()) OR technician_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.user_id = auth.uid())
  OR EXISTS (SELECT 1 FROM public.units u JOIN public.properties p ON p.id = u.property_id
             WHERE u.id = unit_id AND p.owner_id = auth.uid()));
CREATE POLICY maint_insert ON public.maintenance_requests FOR INSERT TO authenticated
WITH CHECK (public.is_staff(auth.uid())
  OR EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = tenant_id AND t.user_id = auth.uid()));
CREATE POLICY maint_update ON public.maintenance_requests FOR UPDATE TO authenticated
USING (public.is_staff(auth.uid()) OR technician_id = auth.uid())
WITH CHECK (public.is_staff(auth.uid()) OR technician_id = auth.uid());
CREATE POLICY maint_delete ON public.maintenance_requests FOR DELETE TO authenticated
USING (public.is_staff(auth.uid()));

CREATE TABLE public.deals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name text NOT NULL,
  phone text,
  request_type text NOT NULL DEFAULT 'إيجار',
  stage text NOT NULL DEFAULT 'lead',
  value numeric NOT NULL DEFAULT 0,
  commission numeric NOT NULL DEFAULT 0,
  property_id uuid REFERENCES public.properties(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.deals TO authenticated;
GRANT ALL ON public.deals TO service_role;
ALTER TABLE public.deals ENABLE ROW LEVEL SECURITY;
CREATE POLICY deals_all ON public.deals FOR ALL TO authenticated
USING (public.is_staff(auth.uid())) WITH CHECK (public.is_staff(auth.uid()));

CREATE TABLE public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone text NOT NULL,
  direction text NOT NULL DEFAULT 'in',
  body text NOT NULL,
  intent text,
  action_taken text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;
ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY wa_read ON public.whatsapp_messages FOR SELECT TO authenticated
USING (public.is_staff(auth.uid()));

CREATE TRIGGER t1 BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t2 BEFORE UPDATE ON public.properties FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t3 BEFORE UPDATE ON public.units FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t4 BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t5 BEFORE UPDATE ON public.leases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t6 BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t7 BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t8 BEFORE UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t9 BEFORE UPDATE ON public.maintenance_requests FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t10 BEFORE UPDATE ON public.deals FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER t11 BEFORE UPDATE ON public.org_settings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.sync_unit_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.units SET status = CASE WHEN EXISTS (
    SELECT 1 FROM public.leases l WHERE l.unit_id = COALESCE(NEW.unit_id, OLD.unit_id) AND l.status = 'active'
  ) THEN 'occupied' ELSE 'vacant' END
  WHERE id = COALESCE(NEW.unit_id, OLD.unit_id);
  RETURN NULL;
END; $$;
CREATE TRIGGER leases_sync_unit AFTER INSERT OR UPDATE OR DELETE ON public.leases
FOR EACH ROW EXECUTE FUNCTION public.sync_unit_status();

INSERT INTO public.org_settings (company_name, vat_number, cr_number, vat_rate, address)
VALUES ('شركة الأملاك المتقدمة', '300000000000003', '1010101010', 15, 'الرياض - حي الملقا');

INSERT INTO public.properties (id, name, property_type, city, district, address, deed_number, owner_name) VALUES
('11111111-1111-1111-1111-111111111111','برج الملقا','سكني','الرياض','الملقا','طريق الملك فهد','310108001234','عبدالله السالم'),
('22222222-2222-2222-2222-222222222222','مجمع النخيل التجاري','تجاري','جدة','النخيل','شارع الأمير سلطان','410108005678','مؤسسة النخيل');

INSERT INTO public.units (id, property_id, unit_number, unit_type, rooms, area, annual_rent, status, electricity_meter_no, water_meter_no) VALUES
('aaaaaaa1-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','101','شقة',3,120,42000,'vacant','E-4471203','W-98120'),
('aaaaaaa2-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','102','شقة',4,150,55000,'vacant','E-4471204','W-98121'),
('aaaaaaa3-1111-1111-1111-111111111111','11111111-1111-1111-1111-111111111111','103','شقة',2,90,33000,'vacant','E-4471205','W-98122'),
('bbbbbbb1-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','M-01','معرض',1,200,120000,'vacant','E-7781100','W-55120'),
('bbbbbbb2-2222-2222-2222-222222222222','22222222-2222-2222-2222-222222222222','M-02','مكتب',2,80,60000,'vacant','E-7781101','W-55121');

INSERT INTO public.tenants (id, full_name, national_id, phone, email) VALUES
('ccccccc1-1111-1111-1111-111111111111','محمد عبدالرحمن القحطاني','1023456789','0555123456','mohammed@example.com'),
('ccccccc2-1111-1111-1111-111111111111','سارة ناصر الدوسري','1098765432','0566998877','sara@example.com'),
('ccccccc3-1111-1111-1111-111111111111','شركة الرؤية للتجارة','7001234567','0533221100','info@rouya.example');

INSERT INTO public.leases (id, unit_id, tenant_id, start_date, end_date, annual_rent, installments, deposit, ejar_contract_no, ejar_status, status) VALUES
('ddddddd1-1111-1111-1111-111111111111','aaaaaaa1-1111-1111-1111-111111111111','ccccccc1-1111-1111-1111-111111111111', current_date - 200, current_date + 165, 42000, 4, 2000, 'EJ-2026-004512','synced','active'),
('ddddddd2-1111-1111-1111-111111111111','aaaaaaa2-1111-1111-1111-111111111111','ccccccc2-1111-1111-1111-111111111111', current_date - 90, current_date + 275, 55000, 2, 3000, NULL,'pending','active'),
('ddddddd3-1111-1111-1111-111111111111','bbbbbbb1-2222-2222-2222-222222222222','ccccccc3-1111-1111-1111-111111111111', current_date - 320, current_date + 45, 120000, 4, 10000, 'EJ-2025-118820','synced','active');

INSERT INTO public.payments (lease_id, amount, due_date, paid_date, status, method) VALUES
('ddddddd1-1111-1111-1111-111111111111',10500, current_date - 190, current_date - 188,'paid','تحويل بنكي'),
('ddddddd1-1111-1111-1111-111111111111',10500, current_date - 100, current_date - 97,'paid','تحويل بنكي'),
('ddddddd1-1111-1111-1111-111111111111',10500, current_date - 8, NULL,'overdue',NULL),
('ddddddd1-1111-1111-1111-111111111111',10500, current_date + 82, NULL,'due',NULL),
('ddddddd2-1111-1111-1111-111111111111',27500, current_date - 85, current_date - 85,'paid','مدى'),
('ddddddd2-1111-1111-1111-111111111111',27500, current_date + 95, NULL,'due',NULL),
('ddddddd3-1111-1111-1111-111111111111',30000, current_date - 310, current_date - 310,'paid','تحويل بنكي'),
('ddddddd3-1111-1111-1111-111111111111',30000, current_date - 220, current_date - 218,'paid','تحويل بنكي'),
('ddddddd3-1111-1111-1111-111111111111',30000, current_date - 130, current_date - 120,'paid','شيك'),
('ddddddd3-1111-1111-1111-111111111111',30000, current_date - 20, NULL,'overdue',NULL);

INSERT INTO public.expenses (property_id, title, category, amount, expense_date) VALUES
('11111111-1111-1111-1111-111111111111','صيانة مصعد','صيانة',3500, current_date - 30),
('11111111-1111-1111-1111-111111111111','فاتورة كهرباء المشترك','خدمات',1800, current_date - 12),
('22222222-2222-2222-2222-222222222222','تنظيف الواجهات','تشغيل',2600, current_date - 5);

INSERT INTO public.maintenance_requests (unit_id, tenant_id, title, description, priority, status, cost, source) VALUES
('aaaaaaa1-1111-1111-1111-111111111111','ccccccc1-1111-1111-1111-111111111111','تسريب في المطبخ','تسريب ماء تحت الحوض','high','new',0,'whatsapp'),
('aaaaaaa2-1111-1111-1111-111111111111','ccccccc2-1111-1111-1111-111111111111','مكيف الصالة لا يبرد',NULL,'medium','in_progress',450,'app'),
('bbbbbbb1-2222-2222-2222-222222222222','ccccccc3-1111-1111-1111-111111111111','تغيير إضاءة المعرض',NULL,'low','done',900,'app');

INSERT INTO public.deals (client_name, phone, request_type, stage, value, commission) VALUES
('فهد العتيبي','0501122334','إيجار','viewing',55000,2750),
('نورة الشمري','0544332211','شراء','negotiation',1250000,31250),
('مجموعة بن سعيد','0577889900','إيجار','won',120000,6000);

INSERT INTO public.invoices (invoice_number, lease_id, customer_name, seller_name, seller_vat_number, subtotal, vat_amount, total, zatca_status, qr_payload) VALUES
('INV-2026-0001','ddddddd1-1111-1111-1111-111111111111','محمد عبدالرحمن القحطاني','شركة الأملاك المتقدمة','300000000000003',10500,1575,12075,'reported','TLNzaGFyaWthIGFsLWFtbGFr'),
('INV-2026-0002','ddddddd3-1111-1111-1111-111111111111','شركة الرؤية للتجارة','شركة الأملاك المتقدمة','300000000000003',30000,4500,34500,'draft',NULL);
