-- المشاريع العقارية (البيع على الخارطة) — الطبقة الأولى: المخطط والصلاحيات والعرض العام.
--
-- ما يعرضه السوق اليوم وحدة واحدة جاهزة. والمشروع شيء آخر: مجمّع أو برج يُطرح قبل اكتماله، له
-- نماذج وحدات (نموذج A ثلاث غرف 140م بسعر كذا)، ونسبة إنجاز، وربع تسليم متوقّع، ومخطط عام.
-- والمشتري لا يشتري وحدة بعينها بل يسجّل اهتمامًا بنموذج.
--
-- النظام السعودي: البيع على الخارطة يتطلب ترخيص «وافي» من الهيئة العامة للعقار، والدفعات تُربط
-- بنسبة الإنجاز عبر حساب ضمان. فرقم ترخيص وافي شرطُ نشرٍ لأي مشروع على الخارطة (الحرس أدناه)،
-- تمامًا كما صار السعر شرطًا لنشر الوحدة.
--
-- الطبقة: المكتب المسجّل الموثّق هو من ينشئ المشروع ويديره (قرار المستخدم 2026-11-18)، وقد يكون
-- المطوّر جهة أخرى فيُسجَّل اسمه نصًّا (developer_name) بلا حساب على المنصة.

-- ── 1. المشروع ──────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  /** المطوّر العقاري — جهة قد لا يكون لها حساب على المنصة. */
  developer_name text CHECK (developer_name IS NULL OR char_length(developer_name) <= 120),
  city text CHECK (city IS NULL OR char_length(city) <= 80),
  district text CHECK (district IS NULL OR char_length(district) <= 80),
  lat double precision CHECK (lat IS NULL OR lat BETWEEN -90 AND 90),
  lng double precision CHECK (lng IS NULL OR lng BETWEEN -180 AND 180),
  description text CHECK (description IS NULL OR char_length(description) <= 4000),
  /** على الخارطة / تحت الإنشاء / جاهز للتسليم. */
  status text NOT NULL DEFAULT 'off_plan'
    CHECK (status IN ('off_plan', 'under_construction', 'ready')),
  completion_pct smallint NOT NULL DEFAULT 0 CHECK (completion_pct BETWEEN 0 AND 100),
  /** ربع التسليم المتوقّع — كما يتحدّث به السوق، لا تاريخًا بعينه. */
  delivery_year smallint CHECK (delivery_year IS NULL OR delivery_year BETWEEN 2024 AND 2060),
  delivery_quarter smallint CHECK (delivery_quarter IS NULL OR delivery_quarter BETWEEN 1 AND 4),
  /** رقم ترخيص «وافي» للبيع على الخارطة (الهيئة العامة للعقار) — شرط نشر مشروع على الخارطة. */
  wafi_license_no text CHECK (wafi_license_no IS NULL OR char_length(wafi_license_no) <= 40),
  /** العدد الإجمالي للوحدات في المشروع (رقم تعريفي؛ المتاح يُحتسب من النماذج). */
  total_units integer CHECK (total_units IS NULL OR total_units BETWEEN 1 AND 100000),
  amenities text[] NOT NULL DEFAULT '{}',
  published boolean NOT NULL DEFAULT false,
  published_at timestamptz,
  /** تمييز يدوي من /hq، بنفس نمط units.featured. */
  featured boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS projects_org_idx ON public.projects (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_published_idx ON public.projects (published, city)
  WHERE published;

-- ── 2. نماذج الوحدات ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.project_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  unit_type text NOT NULL DEFAULT 'شقة' CHECK (char_length(unit_type) <= 40),
  area numeric CHECK (area IS NULL OR (area > 0 AND area <= 100000)),
  rooms smallint CHECK (rooms IS NULL OR rooms BETWEEN 0 AND 50),
  halls smallint CHECK (halls IS NULL OR halls BETWEEN 0 AND 20),
  bathrooms smallint CHECK (bathrooms IS NULL OR bathrooms BETWEEN 0 AND 20),
  /** سعر النموذج — لا يُنشر نموذج بلا سعر (نفس قاعدة الوحدات). */
  price numeric NOT NULL CHECK (price > 0),
  units_count integer CHECK (units_count IS NULL OR units_count BETWEEN 0 AND 100000),
  available_count integer CHECK (available_count IS NULL OR available_count >= 0),
  /** مخطط النموذج: ملف في listing-media تحت projects/<project_id>/. */
  floor_plan_path text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_models_plan_in_project_folder CHECK (
    floor_plan_path IS NULL
    OR (floor_plan_path LIKE 'projects/' || project_id::text || '/%'
        AND floor_plan_path NOT LIKE '%..%')
  ),
  CONSTRAINT project_models_available_within_total CHECK (
    available_count IS NULL OR units_count IS NULL OR available_count <= units_count
  )
);
CREATE INDEX IF NOT EXISTS project_models_project_idx
  ON public.project_models (project_id, position);

-- ── 3. صور المشروع ──────────────────────────────────────────────────────────────────────────────
-- نفس نمط unit_photos: المسار محصور في مجلّد المشروع، ولا يقبل «..».
CREATE TABLE IF NOT EXISTS public.project_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  caption text CHECK (caption IS NULL OR char_length(caption) <= 200),
  position integer NOT NULL DEFAULT 0,
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_photos_path_in_project_folder CHECK (
    path LIKE 'projects/' || project_id::text || '/%' AND path NOT LIKE '%..%'
  )
);
CREATE INDEX IF NOT EXISTS project_photos_project_idx
  ON public.project_photos (project_id, position);

-- ── 4. تسجيل الاهتمام ───────────────────────────────────────────────────────────────────────────
-- لا يُشترى على الخارطة بضغطة: الزائر يسجّل اهتمامًا بنموذج فيتواصل معه المكتب. يُدرَج من الخادم
-- فقط (نفس unit_requests) — لا إدراج مباشر من المتصفح.
CREATE TABLE IF NOT EXISTS public.project_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  model_id uuid REFERENCES public.project_models(id) ON DELETE SET NULL,
  org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL,
  full_name text NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 120),
  phone text NOT NULL CHECK (char_length(phone) BETWEEN 9 AND 20),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 600),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'contacted', 'closed')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS project_interests_org_idx
  ON public.project_interests (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS project_interests_phone_idx
  ON public.project_interests (phone, created_at DESC);

-- ── 5. الصلاحيات: المكتب يدير مشاريعه، والعموم يقرؤون عبر العرض العام فقط ───────────────────────
CREATE OR REPLACE FUNCTION private.org_of_project(_project_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT org_id FROM public.projects WHERE id = _project_id
$$;
REVOKE ALL ON FUNCTION private.org_of_project(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.org_of_project(uuid) TO authenticated, service_role;

-- موظف عضو في المكتب المالك للمشروع.
CREATE OR REPLACE FUNCTION private.can_manage_project_org(_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL
    AND public.is_staff(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = _org AND m.user_id = auth.uid() AND m.kind = 'member'
    )
$$;
REVOKE ALL ON FUNCTION private.can_manage_project_org(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.can_manage_project_org(uuid) TO authenticated, service_role;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.projects FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO authenticated;
GRANT ALL ON public.projects TO service_role;
DROP POLICY IF EXISTS projects_office ON public.projects;
CREATE POLICY projects_office ON public.projects FOR ALL TO authenticated
  USING (private.can_manage_project_org(org_id))
  WITH CHECK (private.can_manage_project_org(org_id));

ALTER TABLE public.project_models ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_models FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_models TO authenticated;
GRANT ALL ON public.project_models TO service_role;
DROP POLICY IF EXISTS project_models_office ON public.project_models;
CREATE POLICY project_models_office ON public.project_models FOR ALL TO authenticated
  USING (private.can_manage_project_org(private.org_of_project(project_id)))
  WITH CHECK (private.can_manage_project_org(private.org_of_project(project_id)));

ALTER TABLE public.project_photos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_photos FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.project_photos TO authenticated;
GRANT ALL ON public.project_photos TO service_role;
DROP POLICY IF EXISTS project_photos_office ON public.project_photos;
CREATE POLICY project_photos_office ON public.project_photos FOR ALL TO authenticated
  USING (private.can_manage_project_org(private.org_of_project(project_id)))
  WITH CHECK (private.can_manage_project_org(private.org_of_project(project_id)));

-- الاهتمامات: يقرؤها مكتب المشروع، ويكتبها الخادم فقط (بيانات تواصل شخصية).
ALTER TABLE public.project_interests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.project_interests FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.project_interests TO authenticated;
GRANT ALL ON public.project_interests TO service_role;
DROP POLICY IF EXISTS project_interests_office ON public.project_interests;
CREATE POLICY project_interests_office ON public.project_interests FOR SELECT TO authenticated
  USING (private.can_manage_project_org(org_id));
DROP POLICY IF EXISTS project_interests_office_update ON public.project_interests;
CREATE POLICY project_interests_office_update ON public.project_interests FOR UPDATE TO authenticated
  USING (private.can_manage_project_org(org_id))
  WITH CHECK (private.can_manage_project_org(org_id));

-- ── 6. حرس النشر: لا يُعرض على الناس مشروع ناقص ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION private.guard_project_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _models integer;
BEGIN
  NEW.updated_at := now();
  IF TG_OP = 'INSERT' THEN
    NEW.created_by := COALESCE(auth.uid(), NEW.created_by);
    -- التمييز من /hq فقط، ولا يُنشَر مشروع بالإدراج مباشرة.
    IF auth.uid() IS NOT NULL THEN
      NEW.featured := false;
      NEW.published := false;
      NEW.published_at := NULL;
    END IF;
  ELSIF auth.uid() IS NOT NULL THEN
    NEW.featured := OLD.featured;
    NEW.org_id := OLD.org_id;
  END IF;

  IF NOT NEW.published THEN
    NEW.published_at := NULL;
    RETURN NEW;
  END IF;

  -- شروط النشر — تُفحص عند النشر فقط، فالمشروع يُحفَظ ناقصًا ويُكمَل على مراحل.
  SELECT count(*) INTO _models FROM public.project_models WHERE project_id = NEW.id;
  IF _models = 0 THEN
    RAISE EXCEPTION 'أضف نموذج وحدة واحدًا على الأقل قبل نشر المشروع' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.city IS NULL OR btrim(NEW.city) = '' THEN
    RAISE EXCEPTION 'أضف مدينة المشروع قبل نشره' USING ERRCODE = 'P0001';
  END IF;
  -- النظام السعودي: البيع على الخارطة لا يُعلَن بلا ترخيص «وافي».
  IF NEW.status = 'off_plan'
     AND (NEW.wafi_license_no IS NULL OR btrim(NEW.wafi_license_no) = '') THEN
    RAISE EXCEPTION 'البيع على الخارطة يتطلب رقم ترخيص «وافي» قبل النشر' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> 'ready' AND (NEW.delivery_year IS NULL OR NEW.delivery_quarter IS NULL) THEN
    RAISE EXCEPTION 'أضف ربع التسليم المتوقّع قبل نشر مشروع غير جاهز' USING ERRCODE = 'P0001';
  END IF;

  -- تاريخ النشر يُثبَّت عند أول نشر فقط، فلا يتجدّد مع كل تعديل على مشروع منشور.
  IF TG_OP = 'INSERT' OR NOT OLD.published THEN NEW.published_at := now(); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS a0_guard_project_publish ON public.projects;
CREATE TRIGGER a0_guard_project_publish BEFORE INSERT OR UPDATE ON public.projects
  FOR EACH ROW EXECUTE FUNCTION private.guard_project_publish();

-- ── 7. العرض العام: نفس بوابة العروض — مكتب ظاهر في الدليل وموثّق ───────────────────────────────
CREATE OR REPLACE VIEW public.projects_public AS
SELECT pr.id, pr.name, pr.developer_name, pr.city, pr.district,
  round(pr.lat::numeric, 2) AS lat, round(pr.lng::numeric, 2) AS lng,
  pr.description, pr.status, pr.completion_pct,
  pr.delivery_year, pr.delivery_quarter, pr.wafi_license_no, pr.total_units, pr.amenities,
  pr.featured, pr.published_at, pr.created_at,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no,
  o.office_phone, o.whatsapp_number,
  (SELECT count(*) FROM public.project_models m WHERE m.project_id = pr.id) AS models_count,
  (SELECT min(m.price) FROM public.project_models m WHERE m.project_id = pr.id) AS price_from,
  (SELECT sum(COALESCE(m.available_count, 0)) FROM public.project_models m
    WHERE m.project_id = pr.id) AS available_units,
  (SELECT ph.path FROM public.project_photos ph WHERE ph.project_id = pr.id
    ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.project_photos ph WHERE ph.project_id = pr.id) AS photos_count
FROM public.projects pr
JOIN public.org_settings o ON o.id = pr.org_id AND o.listed_publicly AND o.verified
WHERE pr.published;
GRANT SELECT ON public.projects_public TO anon, authenticated;

-- النماذج والصور تُقرأ للعموم فقط لمشروع ظاهر في العرض أعلاه.
CREATE OR REPLACE VIEW public.project_models_public AS
SELECT m.id, m.project_id, m.name, m.unit_type, m.area, m.rooms, m.halls, m.bathrooms,
  m.price, m.units_count, m.available_count, m.floor_plan_path, m.position
FROM public.project_models m
WHERE EXISTS (SELECT 1 FROM public.projects_public p WHERE p.id = m.project_id);
GRANT SELECT ON public.project_models_public TO anon, authenticated;

CREATE OR REPLACE VIEW public.project_photos_public AS
SELECT ph.id, ph.project_id, ph.path, ph.caption, ph.position
FROM public.project_photos ph
WHERE EXISTS (SELECT 1 FROM public.projects_public p WHERE p.id = ph.project_id);
GRANT SELECT ON public.project_photos_public TO anon, authenticated;

-- ── 8. التخزين: مجلّد projects/<id>/ في listing-media يعود لمكتب المشروع ────────────────────────
-- بدون هذا لا يستطيع الموظف رفع صور مشروع: سياسة listing-media تشترط media_folder_org = مكتبه.
CREATE OR REPLACE FUNCTION private.media_folder_org(_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $_$
DECLARE f1 text := (storage.foldername(_name))[1]; f2 text := (storage.foldername(_name))[2];
BEGIN
  IF _name ~ '(^|/)\.{1,2}(/|$)' OR _name LIKE '%//%' THEN RETURN NULL; END IF;
  IF f1 = 'owners' THEN
    RETURN (SELECT op.org_id FROM public.owner_pages op
             WHERE op.owner_id = private.try_uuid(f2) AND op.org_id = private.my_org() LIMIT 1);
  ELSIF f1 = 'offices' THEN
    RETURN private.try_uuid(f2);
  ELSIF f1 = 'projects' THEN
    RETURN private.org_of_project(private.try_uuid(f2));
  END IF;
  RETURN private.org_of_unit(private.try_uuid(f1));
END $_$;

-- ── 9. التحقق: تنفيذ فعلي بلا أثر ───────────────────────────────────────────────────────────────
-- يُثبت أن العرض العام والحرس يعملان على بيانات حقيقية، داخل معاملة فرعية تُرجَع.
DO $$
DECLARE n integer; org uuid; pid uuid;
BEGIN
  PERFORM 1 FROM public.projects_public LIMIT 1;
  PERFORM 1 FROM public.project_models_public LIMIT 1;
  PERFORM 1 FROM public.project_photos_public LIMIT 1;
  RAISE NOTICE 'project views OK';

  SELECT id INTO org FROM public.org_settings ORDER BY created_at LIMIT 1;
  IF org IS NULL THEN RAISE NOTICE 'no office to probe with — skipping guard probe'; RETURN; END IF;

  BEGIN
    INSERT INTO public.projects (org_id, name, status, city)
    VALUES (org, 'مشروع فحص الحرس', 'off_plan', 'الرياض')
    RETURNING id INTO pid;

    -- بلا نموذج: يجب أن يُرفض النشر.
    BEGIN
      UPDATE public.projects SET published = true WHERE id = pid;
      RAISE EXCEPTION 'probe_failed: نشر مشروع بلا نماذج لم يُرفض';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'probe_failed%' THEN RAISE; END IF;
    END;

    INSERT INTO public.project_models (project_id, name, price, unit_type)
    VALUES (pid, 'نموذج أ', 900000, 'شقة');

    -- بنموذج لكن بلا ترخيص وافي ومشروع على الخارطة: يجب أن يُرفض كذلك.
    BEGIN
      UPDATE public.projects SET published = true WHERE id = pid;
      RAISE EXCEPTION 'probe_failed: نشر مشروع على الخارطة بلا ترخيص وافي لم يُرفض';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      IF SQLERRM LIKE 'probe_failed%' THEN RAISE; END IF;
    END;

    -- مع الترخيص وربع التسليم: يُنشر.
    UPDATE public.projects
    SET published = true, wafi_license_no = '1234567890',
        delivery_year = 2028, delivery_quarter = 2
    WHERE id = pid;
    SELECT count(*) INTO n FROM public.projects WHERE id = pid AND published AND published_at IS NOT NULL;
    IF n <> 1 THEN RAISE EXCEPTION 'probe_failed: المشروع المكتمل لم يُنشر'; END IF;

    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'probe_rollback' THEN
      RAISE NOTICE 'project publish guard OK (no rows kept)';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
