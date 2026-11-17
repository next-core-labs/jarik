-- «طلب جاد» في سوق الطلبات — قياسًا على Serious Request عند dealapp.sa:
--   صاحب الطلب (زائر بلا حساب) يدفع 60 ريالًا عبر فاتورة ميسر (نفس مسار listing_payments مع
--   kind='request') فيُثبَّت طلبه أول السوق بشارة «طلب جاد» 30 يومًا، وتصل كل المكاتب الظاهرة
--   في الموقع إشعارًا به، ويُسجَّل كل مكتب تواصل معه (market_request_contacts). ضمان جارك:
--   انتهت الثلاثون يومًا بأقل من 3 مكاتب متواصلة → إشعار لمحاسبة المنصة لإعادة المبلغ يدويًا
--   من ميسر (نفس مسار needs_refund).
-- مبني على أحدث التعريفات: settle/revoke_listing_payment في 20261118100000،
-- market_requests والعرض العام في 20260924060526.

-- ── 1. الأعمدة والجداول الجديدة ─────────────────────────────────────────────────────────────────
ALTER TABLE public.market_requests ADD COLUMN IF NOT EXISTS serious_until timestamptz;
COMMENT ON COLUMN public.market_requests.serious_until IS
  'نهاية فترة «الطلب الجاد» المدفوعة؛ NULL = عادي. يكتبها settle_listing_payment فقط';

-- يُفحص الضمان مرة واحدة بعد انتهاء الفترة؛ تمديد جديد يعيده إلى NULL ليُفحص من جديد.
ALTER TABLE public.market_requests ADD COLUMN IF NOT EXISTS serious_reviewed_at timestamptz;

ALTER TABLE public.listing_payments ADD COLUMN IF NOT EXISTS request_id uuid
  REFERENCES public.market_requests(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.listing_payments.request_id IS
  'طلب سوق الطلبات الذي تدفع له رسوم «طلب جاد» (kind=request)؛ NULL لرسوم الوحدات';

ALTER TABLE public.listing_payments DROP CONSTRAINT IF EXISTS listing_payments_kind_check;
ALTER TABLE public.listing_payments ADD CONSTRAINT listing_payments_kind_check
  CHECK (kind IN ('publish', 'feature', 'request'));
ALTER TABLE public.listing_payments DROP CONSTRAINT IF EXISTS listing_payments_request_target_check;
ALTER TABLE public.listing_payments ADD CONSTRAINT listing_payments_request_target_check
  CHECK (kind <> 'request' OR request_id IS NOT NULL);

-- فاتورة مفتوحة واحدة لكل طلب (مثل listing_payments_one_open_per_unit للوحدات).
CREATE UNIQUE INDEX IF NOT EXISTS listing_payments_one_open_per_request
  ON public.listing_payments (request_id) WHERE status = 'initiated' AND request_id IS NOT NULL;

-- كل مكتب تواصل مع طلب جاد — صف واحد لكل (طلب، مكتب)، يسجّله الموظف عند ضغط «اتصال/واتساب».
CREATE TABLE IF NOT EXISTS public.market_request_contacts (
  request_id uuid NOT NULL REFERENCES public.market_requests(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES public.org_settings(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (request_id, org_id)
);
ALTER TABLE public.market_request_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.market_request_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.market_request_contacts TO authenticated;
GRANT ALL ON public.market_request_contacts TO service_role;
DROP POLICY IF EXISTS market_request_contacts_staff_read ON public.market_request_contacts;
CREATE POLICY market_request_contacts_staff_read ON public.market_request_contacts
  FOR SELECT TO authenticated USING (public.is_staff(auth.uid()));

-- الكتابة عبر الدالة فقط: المكتب هو عضوية المتصل، لا ما يدّعيه.
CREATE OR REPLACE FUNCTION public.record_market_request_contact(_request_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _org uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_staff(auth.uid()) THEN RETURN; END IF;
  SELECT m.org_id INTO _org FROM public.org_members m
  WHERE m.user_id = auth.uid() AND m.kind = 'member'
  ORDER BY m.created_at LIMIT 1;
  IF _org IS NULL THEN RETURN; END IF;
  INSERT INTO public.market_request_contacts (request_id, org_id, user_id)
  SELECT r.id, _org, auth.uid() FROM public.market_requests r
  WHERE r.id = _request_id AND r.status = 'open'
  ON CONFLICT DO NOTHING;
END $$;
REVOKE ALL ON FUNCTION public.record_market_request_contact(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_market_request_contact(uuid) TO authenticated;

-- ── 2. العرض العام: شارة «طلب جاد» وعدد المكاتب المتواصلة + الجاد يبقى ظاهرًا طوال فترته ────────
CREATE OR REPLACE VIEW public.market_requests_public AS
SELECT r.id, r.created_at, r.purpose, r.unit_type, r.city, r.district,
  r.budget_min, r.budget_max, r.notes,
  (r.serious_until > now()) IS TRUE AS serious,
  (SELECT count(*)::int FROM public.market_request_contacts c WHERE c.request_id = r.id)
    AS contacts_count
FROM public.market_requests r
WHERE r.status = 'open'
  AND (r.created_at > now() - interval '45 days' OR r.serious_until > now());
-- درس 20261118120000: VIEW يُنشأ بدور تسجيل الدخول المؤقت للـCLI فتفشل قراءة الزوار — المالك postgres.
ALTER VIEW public.market_requests_public OWNER TO postgres;
GRANT SELECT ON public.market_requests_public TO anon, authenticated;

-- ── 3. التسوية: فرع kind='request' يمدّد serious_until ويُشعر المكاتب الظاهرة في الموقع ──────────
CREATE OR REPLACE FUNCTION public.settle_listing_payment(_payment_id uuid, _moyasar_payment_id text)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  pay public.listing_payments%ROWTYPE;
  target record;
  req public.market_requests%ROWTYPE;
  o record;
  reason text;
  label text;
  until timestamptz;
BEGIN
  SELECT * INTO pay FROM public.listing_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing payment % not found', _payment_id USING ERRCODE = 'P0002';
  END IF;

  IF pay.status = 'paid' THEN
    IF pay.kind = 'request' THEN
      SELECT serious_until INTO until FROM public.market_requests WHERE id = pay.request_id;
    ELSE
      SELECT CASE WHEN pay.kind = 'feature' THEN featured_until ELSE market_paid_until END
      INTO until FROM public.units WHERE id = pay.unit_id;
    END IF;
    RETURN until;
  END IF;
  IF pay.status IN ('needs_refund', 'refunded', 'voided') THEN
    RETURN NULL;
  END IF;

  -- «طلب جاد»: يُدفع لطلب ما زال مفتوحًا في السوق؛ طلب أُغلق قبل وصول الدفع يُردّ مبلغه.
  IF pay.kind = 'request' THEN
    SELECT * INTO req FROM public.market_requests WHERE id = pay.request_id FOR UPDATE;
    IF NOT FOUND THEN
      reason := 'حُذف الطلب قبل اكتمال الدفع';
    ELSIF req.status IS DISTINCT FROM 'open' THEN
      reason := 'أُغلق الطلب قبل اكتمال الدفع';
    END IF;

    IF reason IS NOT NULL THEN
      UPDATE public.listing_payments
      SET status = 'needs_refund', paid_at = now(), refund_reason = reason,
          moyasar_payment_id = COALESCE(NULLIF(btrim(_moyasar_payment_id), ''), moyasar_payment_id)
      WHERE id = pay.id;
      PERFORM private.notify_platform_money(NULL, 'رسوم طلب جاد تحتاج استرداد',
        'دفع «' || COALESCE(pay.unit_label, 'طلب') || '» '
          || trim_scale(round(pay.amount_halalas / 100.0, 2))::text || ' '
          || CASE WHEN pay.currency = 'SAR' THEN 'ريال' ELSE pay.currency END
          || ' لتمييز طلبه في سوق الطلبات ولم يُطبَّق: ' || reason
          || '. أعد المبلغ من ميسر (عملية '
          || COALESCE(NULLIF(btrim(_moyasar_payment_id), ''), pay.moyasar_invoice_id, '—') || ').',
        'listing_payments', pay.id);
      RETURN NULL;
    END IF;

    UPDATE public.listing_payments
    SET status = 'paid', paid_at = now(), moyasar_payment_id = NULLIF(btrim(_moyasar_payment_id), '')
    WHERE id = pay.id;

    UPDATE public.market_requests
    SET serious_until = greatest(coalesce(serious_until, now()), now())
                        + make_interval(days => pay.period_days),
        serious_reviewed_at = NULL
    WHERE id = pay.request_id
    RETURNING serious_until INTO until;

    -- وعد «الطلب الجاد»: كل المكاتب الظاهرة في الموقع تعلم به فور الدفع.
    label := COALESCE(NULLIF(req.unit_type, ''),
                      CASE WHEN req.purpose = 'sale' THEN 'طلب شراء' ELSE 'طلب إيجار' END)
      || COALESCE(' في حي ' || NULLIF(req.district, ''), COALESCE(' في ' || NULLIF(req.city, ''), ''));
    FOR o IN SELECT id FROM public.org_settings WHERE verified AND listed_publicly LOOP
      PERFORM private.notify_org_staff(o.id, 'طلب جاد جديد في سوق الطلبات',
        'صاحب «' || label || '» دفع رسوم الطلب الجاد — تواصلوا معه من سوق الطلبات.',
        'market', 'market_requests', req.id);
    END LOOP;
    RETURN until;
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

-- ── 4. الاسترداد: فرع kind='request' يسحب أيام «الطلب الجاد» ────────────────────────────────────
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

  IF pay.status = 'paid' AND pay.request_id IS NOT NULL AND pay.kind = 'request' THEN
    UPDATE public.market_requests
    SET serious_until = greatest(serious_until - make_interval(days => pay.period_days), now()),
        serious_reviewed_at = COALESCE(serious_reviewed_at, now())
    WHERE id = pay.request_id AND serious_until IS NOT NULL;
  ELSIF pay.status = 'paid' AND pay.unit_id IS NOT NULL AND pay.kind = 'feature' THEN
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

-- ── 5. ضمان الطلب الجاد: انتهت الفترة بأقل من 3 مكاتب متواصلة → إشعار محاسبة المنصة ─────────────
CREATE OR REPLACE FUNCTION public.review_serious_request_guarantees()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; cnt integer; pay_ref text; n integer := 0;
BEGIN
  FOR r IN
    SELECT * FROM public.market_requests
    WHERE serious_until IS NOT NULL AND serious_until <= now() AND serious_reviewed_at IS NULL
    ORDER BY serious_until
  LOOP
    UPDATE public.market_requests SET serious_reviewed_at = now() WHERE id = r.id;
    SELECT count(*)::int INTO cnt FROM public.market_request_contacts c WHERE c.request_id = r.id;
    IF cnt >= 3 THEN CONTINUE; END IF;

    SELECT COALESCE(p.moyasar_payment_id, p.moyasar_invoice_id, '—') INTO pay_ref
    FROM public.listing_payments p
    WHERE p.request_id = r.id AND p.kind = 'request' AND p.status = 'paid'
    ORDER BY p.paid_at DESC NULLS LAST LIMIT 1;
    -- فترة بلا دفعة مدفوعة باقية (استُردّت مثلًا) لا ضمان لها.
    IF pay_ref IS NULL THEN CONTINUE; END IF;

    PERFORM private.notify_platform_money(NULL, 'ضمان الطلب الجاد: أعد المبلغ',
      'انتهت فترة الطلب الجاد لـ«' || r.full_name || '» (' || r.phone || ') ولم يتواصل معه سوى '
        || cnt || ' من المكاتب (ضمان جارك: 3 على الأقل). أعد رسوم الطلب الجاد من ميسر (عملية '
        || pay_ref || ').',
      'market_requests', r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE ALL ON FUNCTION public.review_serious_request_guarantees() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_serious_request_guarantees() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'serious-request-guarantees') THEN
    PERFORM cron.schedule('serious-request-guarantees', '30 3 * * *',
      'SELECT public.review_serious_request_guarantees()');
  END IF;
END $$;

-- نفس درس الملكية لكل ما أنشأته هذه الدفعة.
ALTER TABLE public.market_request_contacts OWNER TO postgres;
ALTER FUNCTION public.record_market_request_contact(uuid) OWNER TO postgres;
ALTER FUNCTION public.settle_listing_payment(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.revoke_listing_payment(uuid, text) OWNER TO postgres;
ALTER FUNCTION public.review_serious_request_guarantees() OWNER TO postgres;
