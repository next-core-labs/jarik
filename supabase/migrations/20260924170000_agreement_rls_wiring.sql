-- =============================================================================================
-- ربط الفحص المركزي (private.agreement_permission، من 20260924160000) فعليًا بسياسات RLS على
-- properties/units/leases/maintenance_requests — الجزء المؤجَّل عمدًا من تلك الـ Migration.
--
-- المبدأ: private.staff_scope_ok(org) الحالية (تمنع موظف مكتب من لمس صفوف مكتب آخر) تبقى
-- بلا أي تغيير في تعريفها، ونفس السلوك القائم للمالك/المستأجر/موظف مكتبه الأصلي يبقى كما هو
-- تمامًا. لكل جدول من الأربعة، سياسة org_isolation الواحدة (FOR ALL) تُستبدل بأربع سياسات لكل
-- عملية على حدة (SELECT/INSERT/UPDATE/DELETE)، لأن صلاحية الاتفاقية تختلف حسب العملية — وهذا لا
-- يمكن التعبير عنه بسياسة FOR ALL واحدة بشرط OR واحد بلا منح كتابة أوسع مما يُقصد سهوًا.
--
-- نطاق متعمد لهذه الدفعة (موثّق صراحة، على نمط تضييقات النطاق السابقة بهذه الجلسة):
--   • properties: قراءة فقط عبر الاتفاقية (صلاحية 'view' الضمنية) — لا يوجد مفهوم "كتابة على
--     مستوى العقار" في enum الصلاحيات أصلًا، فتبقى كتابة العقار حكرًا على موظف المكتب الأصلي.
--   • units: قراءة عبر 'view'، وتعديل عبر 'pricing' (الإيجار) أو 'leasing'/'renewal_eviction'
--     (الحالة) أو 'leasing' (بقية الحقول) — بدون إدراج/حذف وحدات عبر اتفاقية، وبدون نقل الوحدة
--     لعقار آخر أو تغيير مالكها المسجَّل بأي صلاحية (حقول هوية هيكلية، لا "بيانات تشغيلية").
--   • leases: قراءة عبر 'view'. الإنشاء عبر 'leasing'. التعديل يُقبل واسعًا على مستوى RLS
--     (أي صلاحية ذات صلة تكفي للوصول للصف)، ثم Trigger ضيق (guard_lease_agreement_columns)
--     يفرض الصلاحية الدقيقة لكل حقل — بالضبط نمط "RLS واسع + Trigger ضيق" المستخدم أصلًا مع
--     maint_tenant_rate/guard_maintenance_columns. موظف المكتب الأصلي لصاحب الوحدة غير متأثر
--     بهذا الـ Trigger إطلاقًا (يُستثنى بالكامل قبل أي فحص خاص بالاتفاقية). unit_id لا يتغيّر عبر
--     أي صلاحية اتفاقية (حقل هوية هيكلي).
--   • maintenance_requests: قراءة/إنشاء/تعديل عبر 'maintenance' فقط.
--
-- هذه نسخة مُصحَّحة بعد مراجعة أمنية عدائية (3 مراجعين مستقلين + تحقق مستقل ثانٍ لكل ملاحظة) على
-- المسودة الأولى، لقت 8 ثغرات حقيقية مؤكدة (5 حرجة/عالية) وأثبتت صحتها جميعًا بالتتبع الفعلي على
-- الكود الحالي. الإصلاحات المدمجة هنا لكل واحدة موثّقة عند موضعها بتعليق يبدأ بـ "إصلاح:".
-- =============================================================================================

-- -----------------------------------------------------------------------------------------------
-- properties: بديل org_isolation الحالية بأربع سياسات محدَّدة العملية. (بلا ملاحظات من المراجعة.)
-- -----------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.property_agreement_view_ok(_property_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.units u
    WHERE u.property_id = _property_id
      AND private.agreement_permission(u.id, public.my_org_id(), 'view')
  )
$$;
REVOKE ALL ON FUNCTION private.property_agreement_view_ok(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.property_agreement_view_ok(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS org_isolation ON public.properties;
CREATE POLICY org_isolation_select ON public.properties AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(org_id) OR private.property_agreement_view_ok(id));
CREATE POLICY org_isolation_insert ON public.properties AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(org_id));
CREATE POLICY org_isolation_update ON public.properties AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(org_id)) WITH CHECK (private.staff_scope_ok(org_id));
CREATE POLICY org_isolation_delete ON public.properties AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(org_id));

-- -----------------------------------------------------------------------------------------------
-- units: قراءة عبر 'view'، تعديل عبر 'pricing' أو 'leasing' (يُفصَّل بالحقل عبر Trigger تحت).
-- -----------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS org_isolation ON public.units;
CREATE POLICY org_isolation_select ON public.units AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'view'));
CREATE POLICY org_isolation_insert ON public.units AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id)));
CREATE POLICY org_isolation_update ON public.units AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'pricing')
       OR private.agreement_permission(id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(id, public.my_org_id(), 'renewal_eviction'))
WITH CHECK (private.staff_scope_ok(private.org_of_property(property_id))
       OR private.agreement_permission(id, public.my_org_id(), 'pricing')
       OR private.agreement_permission(id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(id, public.my_org_id(), 'renewal_eviction'));
CREATE POLICY org_isolation_delete ON public.units AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(private.org_of_property(property_id)));

-- موظف مكتب الاتفاقية (غير مكتب العقار الأصلي) مقصور على annual_rent عبر 'pricing'، الحالة عبر
-- 'leasing' أو 'renewal_eviction'، وبقية الحقول عبر 'leasing'. موظف المكتب الأصلي غير متأثر —
-- يُستثنى أولًا، ومقابل الوحدة *الأصلية* (OLD) لا الهدف (NEW).
CREATE OR REPLACE FUNCTION private.guard_unit_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- إصلاح (ثغرة حرجة #1، property_id): الفحص هنا لازم يكون على مالك الصف *الأصلي* (OLD)، لا
  -- الهدف بعد التعديل (NEW) — فحص NEW بالذات هو ما كان يسمح لمكتب اتفاقية بنقل الوحدة لأحد
  -- عقاراته هو عبر تعديل property_id، ثم المرور من هذا الفحص لأن NEW.property_id صار يخصّه.
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid())
     OR private.staff_scope_ok(private.org_of_property(OLD.property_id)) THEN
    RETURN NEW;
  END IF;

  -- إصلاح (ثغرة حرجة #1 و#4، property_id/owner_id): حقول هوية/ملكية هيكلية، لا "بيانات تشغيلية"
  -- — لا تمنحها أي صلاحية اتفاقية إطلاقًا، يطابق تصريح رأس هذه الـ Migration بعدم وجود كتابة على
  -- مستوى العقار عبر اتفاقية. (private.guard_person_link الموجودة أصلًا كانت تتحقق فقط أن المالك
  -- الجديد "من مكتب صاحب الوحدة"، لا أنه نفس المالك القديم — لا تكفي وحدها لمنع هذا.)
  IF NEW.property_id IS DISTINCT FROM OLD.property_id THEN
    RAISE EXCEPTION 'لا يمكن نقل الوحدة لعقار آخر عبر اتفاقية إدارة' USING ERRCODE = '42501';
  END IF;
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير مالك الوحدة عبر اتفاقية إدارة' USING ERRCODE = '42501';
  END IF;

  IF NEW.annual_rent IS DISTINCT FROM OLD.annual_rent
     AND NOT private.agreement_permission(NEW.id, public.my_org_id(), 'pricing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل الإيجار' USING ERRCODE = '42501';
  END IF;

  -- إصلاح (ثغرة عالية، إنهاء العقد يفشل): الحالة تتغيّر أيضًا تلقائيًا كأثر جانبي لإنهاء عقد
  -- (sync_unit_status، Trigger قائم على leases) — 'renewal_eviction' وحدها (بلا leasing) يجب أن
  -- تكفي، مطابقةً تمامًا لما تسمح به guard_lease_agreement_columns لحالة العقد نفسه.
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT (private.agreement_permission(NEW.id, public.my_org_id(), 'leasing')
              OR private.agreement_permission(NEW.id, public.my_org_id(), 'renewal_eviction')) THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل حالة الوحدة' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - 'annual_rent' - 'status' - 'property_id' - 'owner_id' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'annual_rent' - 'status' - 'property_id' - 'owner_id' - 'updated_at')
     AND NOT private.agreement_permission(NEW.id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل بيانات الوحدة' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_unit_agreement_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_unit_agreement ON public.units;
CREATE TRIGGER guard_unit_agreement BEFORE UPDATE ON public.units
FOR EACH ROW EXECUTE FUNCTION private.guard_unit_agreement_columns();

-- -----------------------------------------------------------------------------------------------
-- leases: قراءة عبر 'view'، إنشاء عبر 'leasing'، تعديل يُقبل واسعًا ثم يُفصَّل بـ Trigger.
-- -----------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS org_isolation ON public.leases;
CREATE POLICY org_isolation_select ON public.leases AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'view'));
CREATE POLICY org_isolation_insert ON public.leases AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'leasing'));
CREATE POLICY org_isolation_update ON public.leases AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'ejar')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'renewal_eviction'))
WITH CHECK (private.staff_scope_ok(private.org_of_unit(unit_id))
       OR private.agreement_permission(unit_id, public.my_org_id(), 'leasing')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'ejar')
       OR private.agreement_permission(unit_id, public.my_org_id(), 'renewal_eviction'));
CREATE POLICY org_isolation_delete ON public.leases AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(private.org_of_unit(unit_id)));

-- موظف مكتب الاتفاقية فقط (موظف المكتب الأصلي يُستثنى أولًا ويبقى بصلاحياته الكاملة القائمة):
--   • tenant_id (عند الإدراج/التعديل، لأي مُنفِّذ — إصلاح فجوة كانت موجودة أصلًا حتى قبل هذه
--     الـ Migration): يلزم أن يكون المستأجر فعلاً من نفس مكتب الوحدة.
--   • unit_id: لا يتغيّر عبر أي صلاحية اتفاقية إطلاقًا (حقل هوية هيكلي).
--   • ejar_contract_no / ejar_status  → يلزم 'ejar'
--   • status → 'ended'/'terminated'   → يلزم 'renewal_eviction'
--   • أي حقل آخر (منها status لغير الإنهاء)  → يلزم 'leasing'
--   • إنشاء عقد جديد                  → يلزم 'leasing'
CREATE OR REPLACE FUNCTION private.guard_lease_agreement_columns() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE home_org_ok boolean;
BEGIN
  -- إصلاح (ثغرة عالية #2، tenant_id مزوَّر): فحص عام يشمل موظف المكتب الأصلي أيضًا عمدًا — هذي
  -- كانت فجوة سلامة بيانات موجودة على leases من الأصل (private.guard_same_org المطبَّقة على
  -- invoices/expenses/deals/maintenance_requests لم تُطبَّق يومًا على leases).
  IF NEW.tenant_id IS NOT NULL
     AND (SELECT t.org_id FROM public.tenants t WHERE t.id = NEW.tenant_id)
         IS DISTINCT FROM private.org_of_unit(NEW.unit_id) THEN
    RAISE EXCEPTION 'المستأجر ليس من نفس مكتب الوحدة' USING ERRCODE = '42501';
  END IF;

  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN
    RETURN NEW;
  END IF;

  -- إصلاح (ثغرة حرجة #3، unit_id): الفحص هنا لازم يكون على الوحدة *الأصلية* (OLD.unit_id عند
  -- التعديل)، لا الهدف (NEW.unit_id) — فحص NEW بالذات هو ما كان يسمح بخطف عقد قائم لوحدة يملكها
  -- مكتب آخر عبر تعديل unit_id لنفسه، ثم المرور من هذا الفحص مباشرة.
  home_org_ok := private.staff_scope_ok(
    private.org_of_unit(CASE WHEN TG_OP = 'UPDATE' THEN OLD.unit_id ELSE NEW.unit_id END));
  IF home_org_ok THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    IF NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
      RAISE EXCEPTION 'صلاحيتك لا تشمل إنشاء عقد جديد' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- unit_id: حقل هوية هيكلي — لا معنى منطقي لـ"نقل" عقد قائم لوحدة أخرى عبر أي صلاحية اتفاقية؛
  -- إعادة إسكان مستأجر تُنشئ عقدًا جديدًا، لا تعدّل unit_id في مكانه.
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الوحدة المرتبطة بالعقد' USING ERRCODE = '42501';
  END IF;

  IF (NEW.ejar_contract_no IS DISTINCT FROM OLD.ejar_contract_no
      OR NEW.ejar_status IS DISTINCT FROM OLD.ejar_status)
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'ejar') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل إدارة إيجار (فال)' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('ended', 'terminated')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'renewal_eviction') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل الإنهاء أو الإخلاء' USING ERRCODE = '42501';
  END IF;

  IF (to_jsonb(NEW) - 'ejar_contract_no' - 'ejar_status' - 'status' - 'updated_at')
     IS DISTINCT FROM (to_jsonb(OLD) - 'ejar_contract_no' - 'ejar_status' - 'status' - 'updated_at')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل شروط العقد' USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NEW.status NOT IN ('ended', 'terminated')
     AND NOT private.agreement_permission(NEW.unit_id, public.my_org_id(), 'leasing') THEN
    RAISE EXCEPTION 'صلاحيتك لا تشمل تعديل حالة العقد' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_lease_agreement_columns() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_lease_agreement ON public.leases;
CREATE TRIGGER guard_lease_agreement BEFORE INSERT OR UPDATE ON public.leases
FOR EACH ROW EXECUTE FUNCTION private.guard_lease_agreement_columns();

-- -----------------------------------------------------------------------------------------------
-- maintenance_requests: قراءة/إنشاء/تعديل عبر 'maintenance' فقط. org_id يبقى مشتقًا من الوحدة
-- الحقيقية دومًا (a_fill_org / private.fill_org_id، من 20260922110000) — لا يمكن لمكتب الاتفاقية
-- تزوير org_id ليتفادى شرط الصلاحية أصلًا.
-- -----------------------------------------------------------------------------------------------
DROP POLICY IF EXISTS org_isolation ON public.maintenance_requests;
CREATE POLICY org_isolation_select ON public.maintenance_requests AS RESTRICTIVE FOR SELECT TO authenticated
USING (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_insert ON public.maintenance_requests AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_update ON public.maintenance_requests AS RESTRICTIVE FOR UPDATE TO authenticated
USING (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')))
WITH CHECK (private.staff_scope_ok(org_id)
       OR (unit_id IS NOT NULL AND private.agreement_permission(unit_id, public.my_org_id(), 'maintenance')));
CREATE POLICY org_isolation_delete ON public.maintenance_requests AS RESTRICTIVE FOR DELETE TO authenticated
USING (private.staff_scope_ok(org_id));

-- إصلاح (ثغرة حرجة #5): guard_maintenance_columns() القائمة (20260924150000، لم تُعدَّل هنا) تمنح
-- أي is_staff() وصولًا كاملًا بلا تفريق بين المكاتب — قبل هذه الـ Migration ما كان يضر، لأن
-- org_isolation القديمة ما كانت تسمح لموظف مكتب آخر يوصل للصف أصلًا. الآن بعد إضافة مسار
-- الاتفاقية، هذا يسمح لمكتب يملك 'maintenance' على وحدة واحدة بـ"سحب" الطلب كاملًا لمكتبه عبر
-- تعديل unit_id (و org_id يتبعه تلقائيًا عبر fill_org_id). Trigger منفصل وضيق يمنع تغيير unit_id
-- إطلاقًا على التعديل — لأي مُنفِّذ، موظف المكتب الأصلي أو مكتب الاتفاقية (قيد سلامة بيانات
-- هيكلي، لا فرقًا بالصلاحية: طلب صيانة مُصنَّف خطأ يُلغى ويُعاد إنشاؤه، لا يُعاد توجيهه).
CREATE OR REPLACE FUNCTION private.guard_maintenance_unit_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.unit_id IS DISTINCT FROM OLD.unit_id THEN
    RAISE EXCEPTION 'لا يمكن تغيير الوحدة المرتبطة بطلب الصيانة' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_maintenance_unit_immutable() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_maintenance_unit ON public.maintenance_requests;
CREATE TRIGGER guard_maintenance_unit BEFORE UPDATE ON public.maintenance_requests
FOR EACH ROW EXECUTE FUNCTION private.guard_maintenance_unit_immutable();

-- إغلاق الفجوة الوظيفية المكتشفة أصلًا: فنّي مكتب الاتفاقية (عضو بمكتبه هو) يُقبل أيضًا، بجانب
-- فنّي مكتب الوحدة الأصلي كما كانت الحال، وفقط إذا كان لمكتب الفني صلاحية 'maintenance' سارية
-- فعليًا على هذه الوحدة تحديدًا.
-- إصلاح (ثغرة حرجة #6): الفرعان يتحققان الآن من m.kind = 'member' — بدونها، أي "عميل" (مالك أو
-- مستأجر مرتبط بمكتب عبر طلب ربط ذاتي، مثلًا) كان يمرّ وكأنه فنّي حقيقي.
-- إصلاح (ثغرة منخفضة): الفرع الثاني يتحقق أيضًا أن مكتب الفني هو *مكتب المنفِّذ نفسه*
-- (m.org_id = public.my_org_id())، لا أي مكتب آخر يصادف أنه يملك صلاحية 'maintenance' على نفس
-- الوحدة — يمنع موظف مكتب من إسناد فنّي مكتب آخر بلا تدخّل ذاك المكتب فعليًا.
CREATE OR REPLACE FUNCTION private.guard_technician() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.technician_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.org_members m
                     WHERE m.user_id = NEW.technician_id AND m.kind = 'member' AND m.org_id = NEW.org_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.org_members m
       WHERE m.user_id = NEW.technician_id
         AND m.kind = 'member'
         AND m.org_id = public.my_org_id()
         AND NEW.unit_id IS NOT NULL
         AND private.agreement_permission(NEW.unit_id, m.org_id, 'maintenance')
     ) THEN
    RAISE EXCEPTION 'الفني ليس من فريق هذا المكتب' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
