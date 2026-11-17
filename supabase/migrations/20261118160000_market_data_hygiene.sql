-- تنظيف السوق العام 2026-11-18 + سدّ الثغرة التي سمحت بالبيانات الفاسدة أصلًا.
--
-- ما وُجد منشورًا للعموم عند الفحص: إعلانان بإيجار 0 (يظهران للزائر بسعر «0 ر.س»)، وإعلان بمدينة
-- «11» وشارع «414» و«414 غرفة» وإيجار 4,144,141 (ضرب لوحة مفاتيح). التنظيف وحده لا يكفي: ما لم
-- يُمنع نشر مثلها ستعود. فالترتيب هنا: حرس دائم أولًا، ثم إخفاء ما هو منشور.
--
-- إلغاء نشر، لا حذف: الصفوف تبقى لمكاتبها (قد تكون وحدات حقيقية بإدخال ناقص)، والمكتب يعيد نشرها
-- بضغطة بعد تصحيح السعر والأرقام. لا شيء هنا لا رجعة فيه.

-- ── 1. العرض العام: إعلان بلا سعر لا يُعرض على أحد ───────────────────────────────────────────────
-- الطبقة الأقوى: تغطي كل مسارات النشر (المجاني للمكتب، والمدفوع للمالك، وتسوية الدفع بدور الخادم
-- التي لا يمر عليها حرس الواجهة). مبني على أحدث تعريف (20261118100000) — نفس الأعمدة بالترتيب.
CREATE OR REPLACE VIEW public.vacant_units_public AS
SELECT u.id, u.unit_number, u.unit_name, u.unit_type, u.district, u.street, u.floor_no,
  u.rooms, u.halls, u.bathrooms, u.area, u.annual_rent, u.sale_price, u.listing_purpose,
  u.furnished, u.listing_description, u.amenities, u.created_at,
  (SELECT ph.path FROM public.unit_photos ph WHERE ph.unit_id = u.id ORDER BY ph.position LIMIT 1) AS cover_path,
  (SELECT count(*) FROM public.unit_photos ph WHERE ph.unit_id = u.id) AS photos_count,
  o.id AS office_id, o.company_name, o.logo_url, o.fal_license_no, o.office_phone, o.whatsapp_number,
  o.city AS office_city, o.district AS office_district,
  op.owner_id AS owner_page_id, op.display_name AS owner_name, op.avatar_path AS owner_avatar_path,
  op.phone AS contact_phone, op.whatsapp AS contact_whatsapp,
  round(p.lat::numeric, 2) AS lat, round(p.lng::numeric, 2) AS lng,
  (u.featured OR (u.featured_until > now()) IS TRUE) AS featured,
  CASE
    WHEN u.list_price > CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END
    THEN u.list_price
  END AS list_price,
  u.furnishing,
  u.furniture,
  p.city,
  u.ad_license_no
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = u.market_org_id
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published AND op.org_id = o.id
WHERE u.status = 'vacant' AND u.market_listed
  AND (u.market_paid_until IS NULL OR u.market_paid_until > now())
  AND u.market_org_id = COALESCE(p.org_id, private.unit_agreement_org(u.id))
  AND (p.org_id IS NOT NULL OR private.agreement_permission(u.id, u.market_org_id, 'leasing'))
  -- جديد: سعر مطلوب فعلي. «0 ر.س» ليس سعرًا، وإعلان بلا سعر يضرّ ثقة الزائر.
  AND (CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END) > 0;
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- ── 2. حرس النشر: رسالة واضحة للمكتب بدل اختفاء صامت ────────────────────────────────────────────
-- مبني على 20261118100000 (الذي أضاف featured_until)، بفحصَي السعر والأرقام قبل السماح بالنشر.
CREATE OR REPLACE FUNCTION private.guard_market_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _office uuid; _property_org uuid; _price numeric;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  -- The publication's office, period and paid feature period are never written by a signed-in user.
  IF TG_OP = 'INSERT' THEN
    NEW.market_paid_until := NULL;
    NEW.market_org_id := NULL;
    NEW.featured_until := NULL;
  ELSE
    NEW.market_paid_until := OLD.market_paid_until;
    NEW.market_org_id := OLD.market_org_id;
    NEW.featured_until := OLD.featured_until;
  END IF;

  IF NOT NEW.market_listed THEN RETURN NEW; END IF;

  -- يُفحص عند النشر فقط (لا عند الحفظ): وحدة بلا سعر تُحفظ وتُدار، لكنها لا تُعرض على الناس.
  _price := CASE WHEN NEW.listing_purpose = 'sale' THEN NEW.sale_price ELSE NEW.annual_rent END;
  IF COALESCE(_price, 0) <= 0 THEN
    RAISE EXCEPTION 'لا يمكن نشر الوحدة بلا سعر — أضف % أولًا',
      CASE WHEN NEW.listing_purpose = 'sale' THEN 'سعر البيع' ELSE 'الإيجار السنوي' END
      USING ERRCODE = 'P0001';
  END IF;
  IF COALESCE(NEW.rooms, 0) > 50 OR COALESCE(NEW.halls, 0) > 20
     OR COALESCE(NEW.bathrooms, 0) > 20 THEN
    RAISE EXCEPTION 'عدد الغرف أو الصالات أو الحمامات غير منطقي — صحّحه قبل النشر'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT p.org_id, COALESCE(p.org_id, private.unit_agreement_org(NEW.id))
  INTO _property_org, _office
  FROM public.properties p WHERE p.id = NEW.property_id;

  -- Office staff (with `leasing` on an owner's unit under an agreement): free, no end date. A paid
  -- period of this same office that is still running is simply superseded.
  IF _office IS NOT NULL
     AND public.is_staff(auth.uid())
     AND EXISTS (
       SELECT 1 FROM public.org_members m
       WHERE m.org_id = _office AND m.user_id = auth.uid() AND m.kind = 'member'
     )
     AND (_property_org IS NOT NULL OR private.agreement_permission(NEW.id, _office, 'leasing')) THEN
    NEW.market_org_id := _office;
    NEW.market_paid_until := NULL;
    RETURN NEW;
  END IF;

  -- Anyone else newly listing a unit (an owner) needs a paid publication.
  IF TG_OP = 'INSERT' OR NOT OLD.market_listed THEN
    RAISE EXCEPTION 'نشر الوحدة في الموقع يتولاه مكتبها مجانًا — أو برسوم نشر للمالك'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ── 3. إخفاء المنشور الفاسد الآن (بقاعدة واضحة، لا بمعرّفات ثابتة) ──────────────────────────────
-- يعمل بدور الـmigration (بلا auth.uid()) فيمرّ على الحرس أعلاه. الصفوف تبقى كما هي.
UPDATE public.units
SET market_listed = false
WHERE market_listed
  AND (rooms > 50 OR halls > 20 OR bathrooms > 20
       OR COALESCE(CASE WHEN listing_purpose = 'sale' THEN sale_price ELSE annual_rent END, 0) <= 0);

-- ── 4. سوق الطلبات: حذف الطلب الذي لا يفيد أي مكتب + تصحيح الإملاء ──────────────────────────────
-- قرار المستخدم 2026-11-18: يُحذف الطلب الفارغ فقط (بلا مدينة ولا حي ولا ميزانية ولا ملاحظات —
-- لا شيء يستطيع مكتب التصرف به، ويحمل اسمًا وجوالًا فحذفه أنظف من إبقائه)، والطلبان الآخران يبقيان.
DELETE FROM public.market_requests
WHERE city IS NULL AND district IS NULL
  AND budget_min IS NULL AND budget_max IS NULL
  AND (notes IS NULL OR btrim(notes) = '');

-- مسافات زائدة في المدينة/الحي تصنع مجموعات مكرّرة في تجميع الأحياء، وإملاء المدينة خطأ يمنع
-- مطابقة الطلب بالعروض. تصحيح لمرة واحدة لما هو مُدخَل، وتطبيع المسافات لكل طلب قادم (البند 5).
UPDATE public.market_requests
SET city = nullif(btrim(city), ''),
    district = nullif(btrim(district), ''),
    notes = nullif(btrim(notes), ''),
    full_name = btrim(full_name)
WHERE city IS DISTINCT FROM nullif(btrim(city), '')
   OR district IS DISTINCT FROM nullif(btrim(district), '')
   OR notes IS DISTINCT FROM nullif(btrim(notes), '')
   OR full_name IS DISTINCT FROM btrim(full_name);

UPDATE public.market_requests SET city = 'الرياض' WHERE city = 'الرياص';
UPDATE public.market_requests SET city = 'مكة' WHERE city IN ('مكه', 'مكة المكرمة');

-- نفس التطبيع لمواقع العقارات والوحدات: «الرياض » و«الرياض» حيّان مختلفان في صفحات الأسعار.
UPDATE public.properties
SET city = nullif(btrim(city), ''), district = nullif(btrim(district), '')
WHERE city IS DISTINCT FROM nullif(btrim(city), '')
   OR district IS DISTINCT FROM nullif(btrim(district), '');

UPDATE public.units
SET district = nullif(btrim(district), ''), street = nullif(btrim(street), '')
WHERE district IS DISTINCT FROM nullif(btrim(district), '')
   OR street IS DISTINCT FROM nullif(btrim(street), '');

-- ── 5. تطبيع المسافات في كل طلب قادم ───────────────────────────────────────────────────────────
-- يسبق enforce_rate_limit أبجديًا، فالتطبيع يحدث قبل أي فحص آخر.
CREATE OR REPLACE FUNCTION private.normalize_market_request()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.full_name := btrim(NEW.full_name);
  NEW.city := nullif(btrim(NEW.city), '');
  NEW.district := nullif(btrim(NEW.district), '');
  NEW.notes := nullif(btrim(NEW.notes), '');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.normalize_market_request() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a0_normalize_market_request ON public.market_requests;
CREATE TRIGGER a0_normalize_market_request BEFORE INSERT OR UPDATE ON public.market_requests
  FOR EACH ROW EXECUTE FUNCTION private.normalize_market_request();
