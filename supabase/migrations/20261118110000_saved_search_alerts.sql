-- تنبيهات البحث المحفوظ («نبّهني إذا نزل عرض يطابق بحثي») — قياسًا على طلبات aqar.fm المحفوظة:
-- الزائر المسجّل يحفظ فلاتر بحثه من سوق العروض، وكل ساعة تفحص دالة cron العروض التي نُشرت منذ آخر
-- تنبيه عبر vacant_units_public نفسه (فلا يصل تنبيه عن شيء غير منشور علنًا)، وتبعث إشعارًا داخليًا
-- واحدًا يلخّص الجديد. بحد أقصى 10 بحوث لكل حساب، والمطابقة النصية بنفس تطبيع العربية في الواجهة
-- (normalizeArabic في src/lib/market.ts).

-- ── 1. تطبيع العربية للمطابقة النصية — مرآة normalizeArabic ─────────────────────────────────────
CREATE OR REPLACE FUNCTION private.normalize_ar(t text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT btrim(translate(
    regexp_replace(lower(coalesce(t, '')), '[ً-ٰٟـ]', '', 'g'),
    'أإآىة٠١٢٣٤٥٦٧٨٩', 'ااايه0123456789'))
$$;
REVOKE ALL ON FUNCTION private.normalize_ar(text) FROM PUBLIC, anon, authenticated;

-- ── 2. البحوث المحفوظة ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- DEFAULT auth.uid(): العميل لا يرسل user_id، والحارس أدناه يثبته على المتصل في كل الأحوال.
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- نفس MarketFilters في الواجهة؛ '' / 0 / NULL = الكل.
  text_query text NOT NULL DEFAULT '' CHECK (char_length(text_query) <= 120),
  purpose text NOT NULL DEFAULT 'all' CHECK (purpose IN ('all', 'rent', 'sale')),
  unit_type text NOT NULL DEFAULT '' CHECK (char_length(unit_type) <= 40),
  min_rooms integer NOT NULL DEFAULT 0 CHECK (min_rooms BETWEEN 0 AND 20),
  furnished text NOT NULL DEFAULT 'all' CHECK (furnished IN ('all', 'yes', 'no')),
  max_price numeric CHECK (max_price IS NULL OR max_price > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- العروض المنشورة بعد هذا الوقت هي «الجديدة»؛ يتقدّم فقط حين يُبعث تنبيه.
  last_notified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS saved_searches_user_idx ON public.saved_searches (user_id, created_at DESC);
-- نفس البحث لا يُحفظ مرتين (الواجهة تعرض 23505 كرسالة ودّية).
CREATE UNIQUE INDEX IF NOT EXISTS saved_searches_dedupe_idx ON public.saved_searches
  (user_id, text_query, purpose, unit_type, min_rooms, furnished, COALESCE(max_price, -1));

ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.saved_searches FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.saved_searches TO authenticated;
GRANT ALL ON public.saved_searches TO service_role;

DROP POLICY IF EXISTS saved_searches_own ON public.saved_searches;
CREATE POLICY saved_searches_own ON public.saved_searches FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- الحارس: الصف دائمًا باسم المتصل وبوقت الآن (لا تنبيهات بأثر رجعي)، وبحد أقصى 10 بحوث.
CREATE OR REPLACE FUNCTION private.guard_saved_search()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  NEW.user_id := auth.uid();
  NEW.last_notified_at := now();
  NEW.created_at := now();
  NEW.text_query := left(btrim(NEW.text_query), 120);
  IF (SELECT count(*) FROM public.saved_searches WHERE user_id = NEW.user_id) >= 10 THEN
    RAISE EXCEPTION 'بحد أقصى 10 بحوث محفوظة — احذف واحدًا أولًا' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS a0_guard_saved_search ON public.saved_searches;
CREATE TRIGGER a0_guard_saved_search BEFORE INSERT ON public.saved_searches
  FOR EACH ROW EXECUTE FUNCTION private.guard_saved_search();

-- ── 3. الفحص الدوري: العروض الجديدة المطابقة → إشعار داخلي واحد لكل بحث ────────────────────────
-- يلتقط «الجديد» بوقت النشر، فيحتاج فهرسًا عليه.
CREATE INDEX IF NOT EXISTS units_market_listed_at_idx ON public.units (market_listed_at)
  WHERE market_listed;

CREATE OR REPLACE FUNCTION public.notify_saved_search_matches()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; cnt integer; first_label text; n integer := 0;
BEGIN
  FOR s IN SELECT * FROM public.saved_searches ORDER BY created_at LOOP
    -- المطابقة عبر vacant_units_public نفسه: لا يصل تنبيه إلا عن عرض منشور يراه الزائر فعلًا.
    SELECT count(*)::int,
      (array_agg(
         concat_ws(' — ', v.unit_type,
           COALESCE('حي ' || v.district, v.city),
           CASE WHEN v.listing_purpose = 'sale' THEN 'للبيع' ELSE 'للإيجار' END)
         ORDER BY u.market_listed_at DESC))[1]
    INTO cnt, first_label
    FROM public.vacant_units_public v
    JOIN public.units u ON u.id = v.id
    WHERE u.market_listed_at > s.last_notified_at
      AND (s.purpose = 'all' OR v.listing_purpose = s.purpose)
      AND (s.unit_type = '' OR v.unit_type = s.unit_type)
      AND (s.min_rooms = 0 OR COALESCE(v.rooms, 0) >= s.min_rooms)
      AND (s.furnished = 'all' OR v.furnished = (s.furnished = 'yes'))
      AND (s.max_price IS NULL
           OR (CASE WHEN v.listing_purpose = 'sale' THEN v.sale_price ELSE v.annual_rent END)
              <= s.max_price)
      AND (private.normalize_ar(s.text_query) = '' OR (
        SELECT bool_and(
          private.normalize_ar(concat_ws(' ',
            v.district, v.street, v.city, v.unit_name, v.unit_number, v.unit_type,
            v.company_name, v.office_city, v.office_district)) LIKE '%' || w || '%')
        FROM unnest(regexp_split_to_array(private.normalize_ar(s.text_query), '\s+')) AS w
        WHERE w <> ''));

    IF cnt > 0 THEN
      INSERT INTO public.notifications (user_id, title, body, kind, source, related_table, related_id)
      VALUES (s.user_id, 'عروض جديدة تطابق بحثك المحفوظ',
        CASE WHEN cnt = 1 THEN 'نزل عرض جديد: ' || first_label
             ELSE 'نزل ' || cnt || ' عروض جديدة، منها: ' || first_label END
          || '. شاهدها في سوق العروض.',
        'market', 'system', 'saved_searches', s.id);
      -- يتقدّم فقط عند التنبيه: «الجديد» يعني «منذ آخر ما أبلغناك».
      UPDATE public.saved_searches SET last_notified_at = now() WHERE id = s.id;
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.notify_saved_search_matches() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_saved_search_matches() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'saved-search-alerts') THEN
    PERFORM cron.schedule('saved-search-alerts', '15 * * * *',
      'SELECT public.notify_saved_search_matches()');
  END IF;
END $$;
