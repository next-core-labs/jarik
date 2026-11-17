-- ميزات السوق 2026-11-18، قياسًا على ما يقدمه aqar.fm:
--   1. إعلان مميز مدفوع: «تمييز الإعلان» 85 ريالًا لكل 30 يومًا عبر فاتورة ميسر (نفس مسار رسوم
--      النشر: listing_payments مع kind='feature'). المميز يظهر أولًا في الفرز الافتراضي للسوق.
--      تمييز لوحة المدير العام اليدوي (units.featured) يبقى كما هو؛ العرض العام يجمع الاثنين.
--   2. رقم ترخيص الإعلان من الهيئة العامة للعقار لكل وحدة (units.ad_license_no) يظهر في صفحة العرض.
--   3. district_price_stats: متوسطات أسعار الأحياء من نفس العروض المنشورة (vacant_units_public)
--      لصفحات الأسعار العامة /prices — لا تكشف إلا ما هو منشور أصلًا.
--   4. owner_listing_stats: مشاهدات وتواصل آخر 30 يومًا لوحدات المالك (listing_events قراءتها
--      للموظفين فقط عبر RLS، فالمالك يأخذ مجاميع وحداته هو عبر دالة SECURITY DEFINER).
-- مبني على أحدث التعريفات: guard_market_publish في 20261111100000، settle/revoke_listing_payment في
-- 20261107150000، vacant_units_public في 20261113100000 (نفس الأعمدة + ad_license_no في النهاية).

-- ── 1. الأعمدة الجديدة ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.units ADD COLUMN IF NOT EXISTS featured_until timestamptz;
COMMENT ON COLUMN public.units.featured_until IS
  'نهاية فترة التمييز المدفوعة (تمييز الإعلان)؛ NULL = لا توجد. يكتبها settle_listing_payment فقط';

ALTER TABLE public.units ADD COLUMN IF NOT EXISTS ad_license_no text
  CHECK (ad_license_no IS NULL OR char_length(ad_license_no) <= 40);
COMMENT ON COLUMN public.units.ad_license_no IS
  'رقم ترخيص الإعلان العقاري من الهيئة العامة للعقار — يظهر في صفحة العرض العامة متى سُجّل';

ALTER TABLE public.listing_payments ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'publish'
  CHECK (kind IN ('publish', 'feature'));
COMMENT ON COLUMN public.listing_payments.kind IS
  'publish: رسوم نشر فترة في الموقع. feature: رسوم تمييز الإعلان (featured_until)';

-- ── 2. مستخدم مسجّل لا يكتب featured_until مباشرة (مثل market_paid_until تمامًا) ────────────────
CREATE OR REPLACE FUNCTION private.guard_market_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _office uuid; _property_org uuid;
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

-- ── 3. التسوية: فرع kind='feature' يمدّد featured_until بدل فترة النشر ───────────────────────────
CREATE OR REPLACE FUNCTION public.settle_listing_payment(_payment_id uuid, _moyasar_payment_id text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.listing_payments%ROWTYPE;
  target record;
  reason text;
  label text;
  until timestamptz;
BEGIN
  SELECT * INTO pay FROM public.listing_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing payment % not found', _payment_id USING ERRCODE = 'P0002';
  END IF;

  IF pay.status = 'paid' THEN
    SELECT CASE WHEN pay.kind = 'feature' THEN featured_until ELSE market_paid_until END
    INTO until FROM public.units WHERE id = pay.unit_id;
    RETURN until;
  END IF;
  IF pay.status IN ('needs_refund', 'refunded', 'voided') THEN
    RETURN NULL;
  END IF;

  SELECT u.id, u.status, u.market_listed, u.market_org_id, u.market_paid_until,
    p.org_id AS property_org,
    COALESCE(p.org_id, private.unit_agreement_org(u.id)) AS office,
    (o.listed_publicly AND o.verified) AS office_visible
  INTO target
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  LEFT JOIN public.org_settings o ON o.id = pay.org_id
  WHERE u.id = pay.unit_id
  FOR UPDATE OF u;

  IF NOT FOUND THEN
    reason := 'حُذفت الوحدة قبل اكتمال الدفع';
  ELSIF target.office IS DISTINCT FROM pay.org_id THEN
    reason := 'لم يعد مكتبك يدير الوحدة';
  ELSIF target.property_org IS NULL AND NOT private.agreement_permission(target.id, pay.org_id, 'leasing') THEN
    reason := 'لم تعد اتفاقية الإدارة تمنح مكتبك صلاحية التأجير';
  ELSIF target.status IS DISTINCT FROM 'vacant' THEN
    reason := 'الوحدة لم تعد شاغرة';
  ELSIF pay.kind = 'feature' AND NOT (
    target.market_listed
    AND target.market_org_id = pay.org_id
    AND (target.market_paid_until IS NULL OR target.market_paid_until > now())
    AND COALESCE(target.office_visible, false)
  ) THEN
    -- التمييز يُدفع لعرض معروض فعلًا في الموقع؛ عرض اختفى قبل وصول الدفع يُردّ مبلغه.
    reason := 'الوحدة لم تعد معروضة في الموقع';
  END IF;

  IF reason IS NOT NULL THEN
    UPDATE public.listing_payments
    SET status = 'needs_refund', paid_at = now(), refund_reason = reason,
        moyasar_payment_id = COALESCE(NULLIF(btrim(_moyasar_payment_id), ''), moyasar_payment_id)
    WHERE id = pay.id;

    label := COALESCE(pay.unit_label, 'وحدة');
    IF pay.org_id IS NOT NULL THEN
      PERFORM private.notify_org_staff(pay.org_id,
        CASE WHEN pay.kind = 'feature' THEN 'لم يُميَّز الإعلان — سيُعاد المبلغ'
             ELSE 'لم تُنشر الوحدة — سيُعاد المبلغ' END,
        'استلمنا ' || CASE WHEN pay.kind = 'feature' THEN 'رسوم تمييز' ELSE 'رسوم نشر' END
          || ' «' || label || '» لكن لم تُطبَّق: ' || reason || '. ستعيد إدارة جارك المبلغ.',
        'unit', 'units', pay.unit_id);
    END IF;
    PERFORM private.notify_platform_money(pay.org_id,
      CASE WHEN pay.kind = 'feature' THEN 'رسوم تمييز تحتاج استرداد' ELSE 'رسوم نشر تحتاج استرداد' END,
      'دفع مكتب ' || COALESCE((SELECT o.company_name FROM public.org_settings o WHERE o.id = pay.org_id), '—')
        || ' ' || trim_scale(round(pay.amount_halalas / 100.0, 2))::text || ' '
        || CASE WHEN pay.currency = 'SAR' THEN 'ريال' ELSE pay.currency END
        || CASE WHEN pay.kind = 'feature' THEN ' لتمييز «' ELSE ' لنشر «' END || label || '» ولم تُطبَّق: ' || reason
        || '. أعد المبلغ من ميسر (عملية ' || COALESCE(NULLIF(btrim(_moyasar_payment_id), ''), pay.moyasar_invoice_id, '—') || ').',
      'listing_payments', pay.id);
    RETURN NULL;
  END IF;

  UPDATE public.listing_payments
  SET status = 'paid', paid_at = now(), moyasar_payment_id = NULLIF(btrim(_moyasar_payment_id), '')
  WHERE id = pay.id;

  IF pay.kind = 'feature' THEN
    UPDATE public.units
    SET featured_until = greatest(coalesce(featured_until, now()), now())
                         + make_interval(days => pay.period_days)
    WHERE id = pay.unit_id
    RETURNING featured_until INTO until;

    PERFORM private.notify_org_staff(pay.org_id, 'تم تمييز الإعلان',
      'تم استلام رسوم التمييز، والإعلان يظهر أولًا في سوق العروض حتى '
        || to_char(until AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || '.',
      'unit', 'units', pay.unit_id);
    RETURN until;
  END IF;

  -- Days left from another office's payment are not this office's: they start from now.
  UPDATE public.units
  SET market_paid_until = greatest(
        CASE WHEN market_org_id = pay.org_id THEN coalesce(market_paid_until, now()) ELSE now() END,
        now()) + make_interval(days => pay.period_days),
      market_listed_at = CASE WHEN market_listed AND market_org_id = pay.org_id
                              THEN market_listed_at ELSE now() END,
      market_org_id = pay.org_id,
      market_listed = true
  WHERE id = pay.unit_id
  RETURNING market_paid_until INTO until;

  -- notify_unit_staff wants a staff caller; the server has none, so the office is notified directly.
  PERFORM private.notify_org_staff(pay.org_id, 'تم نشر الوحدة في الموقع',
    'تم استلام رسوم النشر، والوحدة معروضة في سوق العروض حتى ' || to_char(until AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || '.',
    'unit', 'units', pay.unit_id);
  RETURN until;
END $$;
REVOKE ALL ON FUNCTION public.settle_listing_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_listing_payment(uuid, text) TO service_role;

-- ── 4. الاسترداد: فرع kind='feature' يسحب أيام التمييز ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_listing_payment(_payment_id uuid, _status text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pay public.listing_payments%ROWTYPE; until timestamptz; label text;
BEGIN
  IF _status NOT IN ('refunded', 'voided') THEN
    RAISE EXCEPTION 'unknown listing payment status %', _status USING ERRCODE = '22023';
  END IF;
  SELECT * INTO pay FROM public.listing_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing payment % not found', _payment_id USING ERRCODE = 'P0002';
  END IF;
  IF pay.status IN ('refunded', 'voided') THEN RETURN false; END IF;

  IF pay.status = 'paid' AND pay.unit_id IS NOT NULL AND pay.kind = 'feature' THEN
    UPDATE public.units
    SET featured_until = greatest(featured_until - make_interval(days => pay.period_days), now())
    WHERE id = pay.unit_id AND featured_until IS NOT NULL;

    IF FOUND AND pay.org_id IS NOT NULL THEN
      label := COALESCE(pay.unit_label, 'الإعلان');
      PERFORM private.notify_org_staff(pay.org_id,
        CASE WHEN _status = 'voided' THEN 'أُلغيت رسوم تمييز الإعلان' ELSE 'استُردّت رسوم تمييز الإعلان' END,
        'خُصمت مدة الدفعة من تمييز «' || label || '».',
        'unit', 'units', pay.unit_id);
    END IF;
  ELSIF pay.status = 'paid' AND pay.unit_id IS NOT NULL THEN
    UPDATE public.units
    SET market_paid_until = greatest(market_paid_until - make_interval(days => pay.period_days), now()),
        market_listed = market_listed
          AND market_paid_until - make_interval(days => pay.period_days) > now()
    WHERE id = pay.unit_id AND market_org_id = pay.org_id AND market_paid_until IS NOT NULL
    RETURNING market_paid_until INTO until;

    IF FOUND AND pay.org_id IS NOT NULL THEN
      label := COALESCE(pay.unit_label, 'الوحدة');
      PERFORM private.notify_org_staff(pay.org_id,
        CASE WHEN _status = 'voided' THEN 'أُلغيت رسوم النشر' ELSE 'استُردّت رسوم النشر' END,
        CASE WHEN until > now()
          THEN 'خُصمت مدة الدفعة من نشر «' || label || '»، ويبقى معروضًا حتى '
               || to_char(until AT TIME ZONE 'Asia/Riyadh', 'YYYY-MM-DD') || '.'
          ELSE 'أُخفي «' || label || '» من سوق العروض. ادفع رسوم النشر لعرضه من جديد.'
        END,
        'unit', 'units', pay.unit_id);
    END IF;
  END IF;

  UPDATE public.listing_payments SET status = _status, refunded_at = now() WHERE id = pay.id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.revoke_listing_payment(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_listing_payment(uuid, text) TO service_role;

-- ── 5. العرض العام: featured يجمع اليدوي والمدفوع + رقم ترخيص الإعلان (عمود جديد في النهاية) ─────
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
  AND (p.org_id IS NOT NULL OR private.agreement_permission(u.id, u.market_org_id, 'leasing'));
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- ── 6. متوسطات أسعار الأحياء من نفس العروض المنشورة — لصفحات /prices العامة ─────────────────────
-- مشتق من vacant_units_public نفسه، فلا يكشف إلا ما هو معروض علنًا أصلًا (قاعدة AGENTS.md).
CREATE OR REPLACE VIEW public.district_price_stats AS
SELECT v.city, v.district, v.listing_purpose, v.unit_type,
  count(*)::int AS listings,
  round(avg(CASE WHEN v.listing_purpose = 'sale' THEN v.sale_price ELSE v.annual_rent END))::bigint AS avg_price,
  min(CASE WHEN v.listing_purpose = 'sale' THEN v.sale_price ELSE v.annual_rent END)::bigint AS min_price,
  max(CASE WHEN v.listing_purpose = 'sale' THEN v.sale_price ELSE v.annual_rent END)::bigint AS max_price,
  round(avg(v.area))::int AS avg_area
FROM public.vacant_units_public v
WHERE v.city IS NOT NULL AND v.district IS NOT NULL
  AND (CASE WHEN v.listing_purpose = 'sale' THEN v.sale_price ELSE v.annual_rent END) > 0
GROUP BY v.city, v.district, v.listing_purpose, v.unit_type;
GRANT SELECT ON public.district_price_stats TO anon, authenticated;

-- ── 7. مجاميع أداء إعلانات المالك (آخر 30 يومًا) — listing_events قراءتها للموظفين فقط ───────────
CREATE OR REPLACE FUNCTION public.owner_listing_stats()
RETURNS TABLE (unit_id uuid, views integer, contacts integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.unit_id,
    (count(*) FILTER (WHERE e.event_type = 'view'))::integer,
    (count(*) FILTER (WHERE e.event_type IN ('call_click', 'whatsapp_click')))::integer
  FROM public.listing_events e
  JOIN public.units u ON u.id = e.unit_id
  WHERE u.owner_id = auth.uid()
    AND e.created_at > now() - interval '30 days'
  GROUP BY e.unit_id
$$;
REVOKE ALL ON FUNCTION public.owner_listing_stats() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_listing_stats() TO authenticated;
