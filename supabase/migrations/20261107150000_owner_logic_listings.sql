-- Owner-logic review 2026-11-07, public listings (H8, M4, M5, M6, M7, L1, L2, L3, L5).
-- Product decision 8: a website publication belongs to the office that paid for it
-- (units.market_org_id). It shows only while that office is still the unit's office
-- (= private.unit_office: COALESCE(properties.org_id, private.unit_agreement_org(unit)), which P1 made
-- live-aware) and market_paid_until > now(). Publishing an agreement unit needs the `leasing`
-- permission. Legacy free listings get 30 days from this migration. A payment settled for a unit that
-- is no longer eligible is marked needs_refund and notifies the office and the platform; refunds and
-- voids take the paid days back.
--
-- Bodies are based on the newest definitions: listing_publish_target / settle_listing_payment /
-- expire_paid_market_listings / guard_market_publish from 20261031120000, vacant_units_public from
-- 20261017100000 (same columns, `city` appended), owner_pages_public from 20260929150000 (same
-- columns). Every statement is replay-safe (IF [NOT] EXISTS, CREATE OR REPLACE, guarded UPDATEs).

-- ── 1. The office a publication belongs to ───────────────────────────────────────────────────────
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS market_org_id uuid REFERENCES public.org_settings(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.units.market_org_id IS
  'The office that paid for the current website publication; the unit is shown only while this is still the unit''s office';

-- ── 2. Payment rows outlive their unit, and record refunds ──────────────────────────────────────
-- Deleting a unit used to cascade its payment rows, so a payment arriving later was "ignored" with no
-- record of the money. Keep the row (unit_id NULL) with a snapshot of what was being published.
ALTER TABLE public.listing_payments
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS refund_reason text,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz;

ALTER TABLE public.listing_payments ALTER COLUMN unit_id DROP NOT NULL;
ALTER TABLE public.listing_payments
  DROP CONSTRAINT IF EXISTS listing_payments_unit_id_fkey,
  ADD CONSTRAINT listing_payments_unit_id_fkey
    FOREIGN KEY (unit_id) REFERENCES public.units(id) ON DELETE SET NULL;

-- needs_refund: the money arrived but the unit could no longer be published (platform refunds it).
-- refunded / voided: Moyasar reported the payment refunded or voided.
ALTER TABLE public.listing_payments
  DROP CONSTRAINT IF EXISTS listing_payments_status_check,
  ADD CONSTRAINT listing_payments_status_check
    CHECK (status IN ('initiated', 'paid', 'cancelled', 'needs_refund', 'refunded', 'voided'));

UPDATE public.listing_payments lp
SET unit_label = concat_ws(' · ', 'وحدة ' || u.unit_number, u.unit_type, p.name)
FROM public.units u
JOIN public.properties p ON p.id = u.property_id
WHERE lp.unit_label IS NULL AND u.id = lp.unit_id;

-- ── 3. Backfill (H8, L1) ─────────────────────────────────────────────────────────────────────────
-- A publication belongs to the office that last paid for it; units never paid for (listed before
-- paid publishing) belong to their current office.
UPDATE public.units u
SET market_org_id = COALESCE(
  (SELECT lp.org_id FROM public.listing_payments lp
   WHERE lp.unit_id = u.id AND lp.status = 'paid' AND lp.org_id IS NOT NULL
   ORDER BY lp.paid_at DESC NULLS LAST LIMIT 1),
  (SELECT COALESCE(p.org_id, private.unit_agreement_org(u.id))
   FROM public.properties p WHERE p.id = u.property_id)
)
WHERE u.market_org_id IS NULL AND (u.market_listed OR u.market_paid_until IS NOT NULL);

-- Legacy free listings: 30 days from now, then they expire like any paid period.
UPDATE public.units
SET market_paid_until = now() + interval '30 days'
WHERE market_listed AND market_paid_until IS NULL;

COMMENT ON COLUMN public.units.market_paid_until IS
  'End of the paid website-publication period (paid by market_org_id); legacy free listings got 30 days on 2026-11-07';

-- ── 4. A signed-in user cannot publish an unpaid unit, nor set the paid-until date or its office ─
-- Relisting a hidden unit without paying is allowed only while its paid period runs and was paid by
-- the unit's current office — another office's paid days never carry over (H8).
CREATE OR REPLACE FUNCTION private.guard_market_publish()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _office uuid;
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.market_paid_until := NULL;
    NEW.market_org_id := NULL;
  ELSE
    NEW.market_paid_until := OLD.market_paid_until;
    NEW.market_org_id := OLD.market_org_id;
  END IF;

  IF NEW.market_listed AND (TG_OP = 'INSERT' OR NOT OLD.market_listed) THEN
    SELECT COALESCE(p.org_id, private.unit_agreement_org(NEW.id)) INTO _office
    FROM public.properties p WHERE p.id = NEW.property_id;
    IF NEW.market_paid_until IS NULL OR NEW.market_paid_until <= now()
       OR _office IS NULL OR NEW.market_org_id IS DISTINCT FROM _office THEN
      RAISE EXCEPTION 'نشر الوحدة في الموقع يتطلب دفع رسوم النشر (50 ريال لكل 30 يومًا)'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $$;

-- ── 5. Who may pay for a unit (M4, M5) ───────────────────────────────────────────────────────────
-- Same office resolution as vacant_units_public. Returns no row unless the caller is staff of that
-- office; refuses a unit that is not vacant, and an agreement unit without the `leasing` permission.
CREATE OR REPLACE FUNCTION public.listing_publish_target(_unit_id uuid)
RETURNS TABLE (org_id uuid, office_ready boolean, unit_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
#variable_conflict use_column
DECLARE r record;
BEGIN
  SELECT u.status, p.org_id AS property_org, o.id AS office_id,
    (o.listed_publicly AND o.verified) AS ready,
    concat_ws(' · ', 'وحدة ' || u.unit_number, u.unit_type, p.name) AS label
  INTO r
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
  JOIN public.org_settings o ON o.id = COALESCE(p.org_id, private.unit_agreement_org(u.id))
  WHERE u.id = _unit_id
    AND public.is_staff(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.org_members m
      WHERE m.org_id = o.id AND m.user_id = auth.uid() AND m.kind = 'member'
    );
  IF NOT FOUND THEN RETURN; END IF;

  IF r.property_org IS NULL AND NOT private.agreement_permission(_unit_id, r.office_id, 'leasing') THEN
    RAISE EXCEPTION 'نشر وحدة المالك في الموقع يحتاج صلاحية «التأجير» في اتفاقية الإدارة'
      USING ERRCODE = '42501';
  END IF;
  IF r.status IS DISTINCT FROM 'vacant' THEN
    RAISE EXCEPTION 'الوحدة غير شاغرة — لا يُنشر في الموقع إلا الوحدات الشاغرة' USING ERRCODE = 'P0001';
  END IF;

  RETURN QUERY SELECT r.office_id, r.ready, r.label;
END $$;
REVOKE ALL ON FUNCTION public.listing_publish_target(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listing_publish_target(uuid) TO authenticated;

-- ── 6. Platform staff who handle refunds: the system admin and HQ admins with `accounting` ──────
CREATE OR REPLACE FUNCTION private.notify_platform_money(
  _org uuid, _title text, _body text, _table text, _id uuid
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications (user_id, org_id, title, body, kind, source, related_table, related_id)
  SELECT staff.user_id, COALESCE(_org, private.primary_org()), _title, _body, 'system', 'system', _table, _id
  FROM (
    SELECT r.user_id FROM public.user_roles r WHERE r.role = 'super_admin'
    UNION
    SELECT h.user_id FROM public.hq_admins h WHERE 'accounting' = ANY(h.permissions)
  ) staff
$$;
REVOKE ALL ON FUNCTION private.notify_platform_money(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 7. Settlement (M5): publish only a unit that is still eligible ──────────────────────────────
-- Called by the server only after Moyasar confirms the payment. Idempotent: the browser return and the
-- webhook may both arrive. Returns the new paid-until date, or NULL when nothing was published
-- (needs_refund / refunded / voided rows).
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
    SELECT market_paid_until INTO until FROM public.units WHERE id = pay.unit_id;
    RETURN until;
  END IF;
  IF pay.status IN ('needs_refund', 'refunded', 'voided') THEN
    RETURN NULL;
  END IF;

  SELECT u.id, u.status, p.org_id AS property_org,
    COALESCE(p.org_id, private.unit_agreement_org(u.id)) AS office
  INTO target
  FROM public.units u
  JOIN public.properties p ON p.id = u.property_id
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
  END IF;

  IF reason IS NOT NULL THEN
    UPDATE public.listing_payments
    SET status = 'needs_refund', paid_at = now(), refund_reason = reason,
        moyasar_payment_id = COALESCE(NULLIF(btrim(_moyasar_payment_id), ''), moyasar_payment_id)
    WHERE id = pay.id;

    label := COALESCE(pay.unit_label, 'وحدة');
    IF pay.org_id IS NOT NULL THEN
      PERFORM private.notify_org_staff(pay.org_id, 'لم تُنشر الوحدة — سيُعاد المبلغ',
        'استلمنا رسوم نشر «' || label || '» لكن لم تُنشر: ' || reason || '. ستعيد إدارة جارك المبلغ.',
        'unit', 'units', pay.unit_id);
    END IF;
    PERFORM private.notify_platform_money(pay.org_id, 'رسوم نشر تحتاج استرداد',
      'دفع مكتب ' || COALESCE((SELECT o.company_name FROM public.org_settings o WHERE o.id = pay.org_id), '—')
        || ' ' || trim_scale(round(pay.amount_halalas / 100.0, 2))::text || ' '
        || CASE WHEN pay.currency = 'SAR' THEN 'ريال' ELSE pay.currency END
        || ' لنشر «' || label || '» ولم تُنشر: ' || reason
        || '. أعد المبلغ من ميسر (عملية ' || COALESCE(NULLIF(btrim(_moyasar_payment_id), ''), pay.moyasar_invoice_id, '—') || ').',
      'listing_payments', pay.id);
    RETURN NULL;
  END IF;

  UPDATE public.listing_payments
  SET status = 'paid', paid_at = now(), moyasar_payment_id = NULLIF(btrim(_moyasar_payment_id), '')
  WHERE id = pay.id;

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

-- ── 8. Refund / void (L2): take the paid days back ──────────────────────────────────────────────
-- Called by the server after Moyasar reports the payment refunded or voided. A published period is
-- pulled back by the payment's period_days (not below now(); the unit leaves the site if nothing is
-- left), only while the publication is still the paying office's. Returns false if already recorded.
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

  IF pay.status = 'paid' AND pay.unit_id IS NOT NULL THEN
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

-- ── 9. Expiry: a paid period that ran out takes the unit off the website ─────────────────────────
-- The public view checks market_paid_until itself (L3), so a late or stopped run no longer leaves an
-- expired unit on the site; this job clears the flag and tells the office that paid.
CREATE OR REPLACE FUNCTION public.expire_paid_market_listings()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; n integer := 0;
BEGIN
  FOR r IN
    UPDATE public.units SET market_listed = false
    WHERE market_listed AND market_paid_until IS NOT NULL AND market_paid_until <= now()
    RETURNING id, property_id, market_org_id
  LOOP
    PERFORM private.notify_org_staff(
      COALESCE(r.market_org_id,
        (SELECT COALESCE(p.org_id, private.unit_agreement_org(r.id)) FROM public.properties p WHERE p.id = r.property_id)),
      'انتهت مدة نشر الوحدة',
      'انتهت مدة النشر المدفوعة وأُخفيت الوحدة من سوق العروض. جدّد النشر من «الأملاك والوحدات».',
      'unit', 'units', r.id);
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
REVOKE EXECUTE ON FUNCTION public.expire_paid_market_listings() FROM PUBLIC, anon, authenticated;

-- ── 10. Public listings (H8, L3, M7, L5) ─────────────────────────────────────────────────────────
-- Same columns as 20261017100000 plus `city` (the property's city) at the end. A unit shows only while
-- the office that paid is still its office and the paid period runs; the owner's page is attached
-- only when that same office published it. Units of a property with neither an office nor an owner no
-- longer fall back to the owner's membership or the platform's oldest office.
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
  u.featured,
  CASE
    WHEN u.list_price > CASE WHEN u.listing_purpose = 'sale' THEN u.sale_price ELSE u.annual_rent END
    THEN u.list_price
  END AS list_price,
  u.furnishing,
  u.furniture,
  p.city
FROM public.units u
LEFT JOIN public.properties p ON p.id = u.property_id
JOIN public.org_settings o ON o.listed_publicly AND o.verified AND o.id = u.market_org_id
LEFT JOIN public.owner_pages op ON op.owner_id = u.owner_id AND op.published AND op.org_id = o.id
WHERE u.status = 'vacant' AND u.market_listed AND u.market_paid_until > now()
  AND u.market_org_id = COALESCE(p.org_id, private.unit_agreement_org(u.id));
GRANT SELECT ON public.vacant_units_public TO anon, authenticated;

-- ── 11. Public owner pages (M6, M7) ──────────────────────────────────────────────────────────────
-- Same columns as 20260929150000. Contact falls back to the page's own office, never to the platform's
-- oldest office. A page is public while its office is listed and verified and still manages one of the
-- owner's units or properties — the condition every listing that links to it already meets, so a
-- listing card never links to a missing page.
CREATE OR REPLACE VIEW public.owner_pages_public AS
SELECT op.owner_id, op.display_name, op.bio, op.areas, op.property_types, op.avatar_path,
       COALESCE(NULLIF(op.phone, ''), o.office_phone) AS phone,
       COALESCE(NULLIF(op.whatsapp, ''), NULLIF(op.phone, ''), o.whatsapp_number, o.office_phone) AS whatsapp,
       (SELECT count(*) FROM public.vacant_units_public v WHERE v.owner_page_id = op.owner_id) AS listings_count
FROM public.owner_pages op
JOIN public.org_settings o ON o.id = op.org_id AND o.listed_publicly AND o.verified
WHERE op.published
  AND EXISTS (
    SELECT 1 FROM public.properties p
    WHERE p.owner_id = op.owner_id AND p.org_id = op.org_id
    UNION ALL
    SELECT 1 FROM public.units u
    JOIN public.properties p2 ON p2.id = u.property_id
    WHERE COALESCE(u.owner_id, p2.owner_id) = op.owner_id
      AND COALESCE(p2.org_id, private.unit_agreement_org(u.id)) = op.org_id
  );
GRANT SELECT ON public.owner_pages_public TO anon, authenticated;
