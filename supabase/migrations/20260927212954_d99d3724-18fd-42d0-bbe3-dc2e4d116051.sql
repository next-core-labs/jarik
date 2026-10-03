-- المرحلة E من توسيع لوحة "المدير العام" (/hq): صفحتا الشروط وسياسة الخصوصية، محتواهما قابل
-- للتعديل من الواجهة بدل نشر كود جديد لكل تعديل صياغة. حصرًا لمالك الموقع (super_admin) — بلا
-- تفويض لمدراء HQ (لا صلاحية hq_admins جديدة)، لحساسية المحتوى القانوني.
CREATE TABLE public.legal_pages (
  slug text PRIMARY KEY,
  title text NOT NULL,
  body text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.legal_pages (slug, title, body) VALUES
  ('terms', 'الشروط والأحكام',
   'هذا نص مبدئي عام — يحتاج مراجعة قانونية واعتمادًا نهائيًا قبل الاعتماد عليه فعليًا. يمكن تعديله من لوحة المدير العام.'),
  ('privacy', 'سياسة الخصوصية',
   'هذا نص مبدئي عام — يحتاج مراجعة قانونية واعتمادًا نهائيًا قبل الاعتماد عليه فعليًا. يمكن تعديله من لوحة المدير العام.');
GRANT SELECT ON public.legal_pages TO anon, authenticated;
GRANT ALL ON public.legal_pages TO service_role;
ALTER TABLE public.legal_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY legal_pages_read ON public.legal_pages FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.set_legal_page(_slug text, _title text, _body text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'هذه العملية لمالك الموقع فقط';
  END IF;
  IF length(trim(_title)) = 0 OR length(trim(_body)) = 0 THEN
    RAISE EXCEPTION 'العنوان والمحتوى لازم يكونان معبَّين';
  END IF;
  UPDATE public.legal_pages
  SET title = trim(_title), body = _body, updated_at = now()
  WHERE slug = _slug;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'صفحة غير معروفة';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.set_legal_page(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_legal_page(text, text, text) TO authenticated;