-- إصلاح: حرس النشر كان يمنع نشر وحدة للحجز اليومي.
--
-- حرس 20261118160000 يرفض نشر وحدة بلا سعر — وقُصد به ألّا يرى الزائر «0 ر.س». لكن وحدة للحجز
-- اليومي (شاليه، استراحة) ليس لها سعر سنوي ولا سعر بيع: سعرها سعر ليلة في unit_booking_settings.
-- فكان المكتب يُفعّل الحجز بسعر ليلة ثم يُرفض نشره — والميزة التي أُضيفت أمس غير قابلة للاستخدام
-- من الواجهة أصلًا (سكربت الاستيراد يمرّ لأن الحرس لا يعمل بلا auth.uid()، وهذا أخفى الخلل).
--
-- الحماية الحقيقية من «0 ر.س» ليست هذا الحرس بل شرط السعر في vacant_units_public (سوق الإيجار
-- والبيع)، و bookable_units_public يشترط سعر ليلة > 0 ورخصة إيواء. فالحرس رسالة مبكرة للمكتب لا
-- أكثر، وتخفيفه هنا لا يفتح بابًا: الوحدة بلا أي سعر لا تظهر في أي من السوقين.
--
-- مبني على 20261118160000 + featured_until (20261118100000) — نفس المنطق، بشرط السعر معدَّلًا.

CREATE OR REPLACE FUNCTION private.guard_market_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _office uuid; _property_org uuid; _price numeric; _nightly boolean;
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

  -- سعر سنوي/بيع، أو سعر ليلة لوحدة حجز يومي — أحدهما يكفي.
  _price := CASE WHEN NEW.listing_purpose = 'sale' THEN NEW.sale_price ELSE NEW.annual_rent END;
  SELECT EXISTS (
    SELECT 1 FROM public.unit_booking_settings s
    WHERE s.unit_id = NEW.id AND s.enabled AND COALESCE(s.nightly_rate, 0) > 0
  ) INTO _nightly;

  IF COALESCE(_price, 0) <= 0 AND NOT _nightly THEN
    RAISE EXCEPTION 'لا يمكن نشر الوحدة بلا سعر — أضف % أو فعّل الحجز اليومي بسعر ليلة',
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

  IF TG_OP = 'INSERT' OR NOT OLD.market_listed THEN
    RAISE EXCEPTION 'نشر الوحدة في الموقع يتولاه مكتبها مجانًا — أو برسوم نشر للمالك'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $$;

-- ── التحقق: تنفيذ فعلي بصلاحيات مستخدم حقيقي، بلا أثر ───────────────────────────────────────────
-- الحرس لا يعمل إلا مع auth.uid() — وهذا ما أخفى الخلل أمس (الـprobe كان بلا مستخدم). هنا يُنتحل
-- موظف المكتب فعلًا بـ SET LOCAL ROLE + request.jwt.claims، فيمرّ الحرس كما يمرّ من الواجهة.
DO $$
DECLARE _unit uuid; _staff uuid; _org uuid; _ok boolean;
BEGIN
  SELECT u.id, COALESCE(p.org_id, private.unit_agreement_org(u.id))
  INTO _unit, _org
  FROM public.units u JOIN public.properties p ON p.id = u.property_id
  WHERE u.status = 'vacant' AND COALESCE(p.org_id, private.unit_agreement_org(u.id)) IS NOT NULL
  LIMIT 1;
  IF _unit IS NULL THEN RAISE NOTICE 'no vacant unit to probe with — skipped'; RETURN; END IF;

  SELECT m.user_id INTO _staff
  FROM public.org_members m
  WHERE m.org_id = _org AND m.kind = 'member' AND public.is_staff(m.user_id)
  LIMIT 1;
  IF _staff IS NULL THEN RAISE NOTICE 'no staff member to impersonate — skipped'; RETURN; END IF;

  BEGIN
    -- وحدة بلا أي سعر: النشر يجب أن يُرفض.
    UPDATE public.units SET annual_rent = 0, sale_price = 0, market_listed = false
    WHERE id = _unit;
    DELETE FROM public.unit_booking_settings WHERE unit_id = _unit;

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _staff)::text, true);
    SET LOCAL ROLE authenticated;

    BEGIN
      UPDATE public.units SET market_listed = true WHERE id = _unit;
      RESET ROLE;
      RAISE EXCEPTION 'probe_failed: نُشرت وحدة بلا أي سعر';
    EXCEPTION WHEN sqlstate 'P0001' THEN
      RESET ROLE;
      IF SQLERRM LIKE 'probe_failed%' THEN RAISE; END IF;
    END;

    -- نفس الوحدة بسعر ليلة: النشر يجب أن يُقبل (هذا ما كان مرفوضًا قبل الإصلاح).
    INSERT INTO public.unit_booking_settings (unit_id, enabled, nightly_rate, tourism_license_no)
    VALUES (_unit, true, 1200, 'TL-PROBE')
    ON CONFLICT (unit_id) DO UPDATE
      SET enabled = true, nightly_rate = 1200, tourism_license_no = 'TL-PROBE';

    PERFORM set_config('request.jwt.claims', json_build_object('sub', _staff)::text, true);
    SET LOCAL ROLE authenticated;
    UPDATE public.units SET market_listed = true WHERE id = _unit;
    RESET ROLE;

    SELECT market_listed INTO _ok FROM public.units WHERE id = _unit;
    IF NOT _ok THEN RAISE EXCEPTION 'probe_failed: وحدة بسعر ليلة لم تُنشر'; END IF;

    RAISE EXCEPTION 'probe_rollback';
  EXCEPTION WHEN raise_exception THEN
    RESET ROLE;
    IF SQLERRM = 'probe_rollback' THEN
      RAISE NOTICE 'publish guard OK: no price refused, nightly rate accepted (no rows kept)';
    ELSE
      RAISE;
    END IF;
  END;
END $$;
