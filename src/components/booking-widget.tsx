import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CalendarCheck, CheckCircle2, Clock, Users } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import { publicNum, publicSar } from "@/lib/format";
import { translate, type Locale } from "@/lib/i18n";
import { parseSaudiMobile } from "@/lib/public-form";
import { quoteBooking, submitBooking } from "@/lib/bookings.functions";
import {
  addDays,
  dayLabel,
  firstFreeCheckin,
  nightsBetween,
  overlapsBooked,
  stayLabel,
  toDateInput,
  type BookedRange,
} from "@/lib/bookings";

/**
 * حجز وحدة بالليلة. السعر والإتاحة يأتيان من القاعدة (quote_booking) مع كل تغيير للتواريخ — فما
 * يراه الضيف هو ما سيُسجَّل عليه بالضبط. فحص التزاحم في الواجهة يعطّل الزر مبكرًا فقط؛ الرفض
 * الحقيقي من قيد EXCLUDE في القاعدة، وهو من يحمي من حجزين في اللحظة نفسها.
 *
 * الليالي المشغولة تُزيح الاختيار ولا تغلق الوحدة: النموذج يفتح على أول ليلة حرّة لا على «غدًا»
 * دائمًا، ويعرض ما هو محجوز، ويدلّ على أقرب بديل حين يقع اختيار الضيف على ليلة مشغولة — فحجب
 * ثلاث ليالٍ لا يبدو للزائر كأن الشاليه لا يُحجز أبدًا.
 */
export function BookingWidget({
  unitId,
  locale = "ar",
  nightlyRate,
  weekendRate,
  minNights,
  maxGuests,
  checkinTime,
  checkoutTime,
  freeCancelDays,
  houseRules,
  tourismLicenseNo,
}: {
  unitId: string;
  locale?: Locale;
  nightlyRate: number;
  weekendRate: number | null;
  minNights: number;
  maxGuests: number | null;
  checkinTime: string | null;
  checkoutTime: string | null;
  freeCancelDays: number;
  houseRules: string | null;
  tourismLicenseNo: string | null;
}) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const today = toDateInput(new Date());
  const [from, setFrom] = useState(addDays(today, 1));
  const [to, setTo] = useState(addDays(today, 1 + Math.max(1, minNights)));
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [guests, setGuests] = useState("");
  // false = أُرسل بلا حساب؛ true = رُبط بحساب الضيف فيظهر في «حجوزاتي».
  const [done, setDone] = useState<null | { linked: boolean }>(null);

  // الليالي المشغولة: لتظليل مبكر ورسالة فورية بلا انتظار رد الخادم.
  const booked = useQuery({
    queryKey: ["unit-booked-dates", unitId],
    staleTime: 30_000,
    queryFn: async (): Promise<BookedRange[]> => {
      const { data, error } = await supabase
        .from("unit_booked_dates_public")
        .select("from_date, to_date")
        .eq("unit_id", unitId);
      if (error) throw error;
      return (data ?? []).filter(
        (r): r is BookedRange => Boolean(r.from_date) && Boolean(r.to_date),
      );
    },
  });

  // الخروج يتبع الدخول دائمًا: تاريخ خروج قبل أقل مدة لا معنى له.
  useEffect(() => {
    if (nightsBetween(from, to) < Math.max(1, minNights)) {
      setTo(addDays(from, Math.max(1, minNights)));
    }
  }, [from, to, minNights]);

  // أول ليلة حرّة بدل «غدًا» — مرة واحدة حين تصل الليالي المشغولة، فلا يُلغى اختيار الضيف بعدها.
  const snapped = useRef(false);
  useEffect(() => {
    if (snapped.current || !booked.data) return;
    snapped.current = true;
    if (!overlapsBooked(from, to, booked.data)) return;
    const free = firstFreeCheckin(from, Math.max(1, minNights), booked.data);
    if (!free) return;
    setFrom(free);
    setTo(addDays(free, Math.max(1, minNights)));
  }, [booked.data, from, to, minNights]);

  const getQuote = useServerFn(quoteBooking);
  const quote = useQuery({
    queryKey: ["booking-quote", unitId, from, to],
    enabled: nightsBetween(from, to) > 0,
    queryFn: async () => await getQuote({ data: { unitId, from, to } }),
  });

  const send = useServerFn(submitBooking);
  const book = useMutation({
    mutationFn: async () =>
      await send({
        data: {
          unitId,
          from,
          to,
          fullName: name.trim(),
          // مطبّعًا 05XXXXXXXX كبقية نماذج الموقع العامة.
          phone: mobile ?? phone.trim(),
          ...(guests.trim() ? { guests: Number(guests) } : {}),
        },
      }),
    onSuccess: (res) => setDone({ linked: res.linked }),
    onError: (e: Error) => toast.error(userErrorMessage(e, t("bk_error"))),
  });

  const mobile = parseSaudiMobile(phone);
  const phoneError = phone.trim() !== "" && !mobile ? t("ld_req_phone_invalid") : null;
  const bookedRanges = booked.data ?? [];
  const localOverlap = overlapsBooked(from, to, bookedRanges);
  const q = quote.data;
  const nights = nightsBetween(from, to);
  // المدة التي اختارها الضيف تُنقل كما هي إلى التاريخ البديل، ولا تقلّ عن أقل مدة للوحدة.
  const wantNights = Math.max(nights, Math.max(1, minNights));
  // بديل يُقترح فقط حين يقع الاختيار على ليلة مشغولة.
  const suggestion = localOverlap ? firstFreeCheckin(from, wantNights, bookedRanges) : null;
  // أقرب ثلاثة مدايات مشغولة: الضيف يرى ما هو محجوز بدل أن يجرّب التواريخ واحدًا واحدًا.
  const upcomingBooked = [...bookedRanges]
    .filter((b) => b.to_date > today)
    .sort((a, b) => a.from_date.localeCompare(b.from_date))
    .slice(0, 3);
  const canBook =
    Boolean(q?.available) &&
    !localOverlap &&
    name.trim().length >= 2 &&
    // رقم سعودي فعلًا: المكتب يتصل بالضيف، فرقم غير قابل للاتصال حجز ميّت.
    mobile !== null;

  if (done) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-6 text-center">
        <CheckCircle2 className="size-8 text-brass" aria-hidden />
        <p className="text-sm font-medium">{t("bk_done")}</p>
        <p className="text-xs text-muted-foreground">{t("bk_done_note")}</p>
        {done.linked ? (
          <Button size="sm" variant="outline" asChild>
            <Link to="/my-bookings">{t("bk_done_mine")}</Link>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{t("bk_done_signin")}</p>
        )}
      </div>
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canBook) book.mutate();
      }}
    >
      <div className="flex flex-col gap-0.5">
        <h2 className="text-lg font-bold">{t("bk_title")}</h2>
        <p className="flex flex-wrap items-baseline gap-1.5 text-sm text-muted-foreground">
          <span className="text-[22px] font-bold text-foreground tabular-nums">
            {publicSar(nightlyRate, locale)}
          </span>
          {t("bk_per_night")}
          {weekendRate && weekendRate !== nightlyRate ? (
            <span className="text-xs">
              {` · ${t("bk_weekend")} ${publicSar(weekendRate, locale)}`}
            </span>
          ) : null}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1.5 text-sm">
          {t("bk_checkin")}
          <Input
            type="date"
            value={from}
            min={today}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          {t("bk_checkout")}
          <Input
            type="date"
            value={to}
            min={addDays(from, Math.max(1, minNights))}
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </label>
      </div>

      {upcomingBooked.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("bk_booked_dates")}:{" "}
          {upcomingBooked.map((b) => stayLabel(b.from_date, b.to_date, locale)).join(" · ")}
        </p>
      ) : null}

      {/* السبب يأتي من القاعدة بنصّه: «محجوزة»، «أقل مدة n ليلة»، «تاريخ ماضٍ»… */}
      {localOverlap ? (
        <div className="flex flex-col items-start gap-2 rounded-sm bg-muted/60 px-3 py-2">
          <p className="text-xs font-medium">{t("bk_taken")}</p>
          {suggestion ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setFrom(suggestion);
                setTo(addDays(suggestion, wantNights));
              }}
            >
              {t("bk_next_free")}: {dayLabel(suggestion, locale)}
            </Button>
          ) : null}
        </div>
      ) : q && !q.available && q.reason ? (
        <p className="rounded-sm bg-muted/60 px-3 py-2 text-xs font-medium">{q.reason}</p>
      ) : null}

      {q?.available && nights > 0 ? (
        <div className="flex flex-col gap-1 border-y border-border py-3 text-sm">
          {q.weekdayNights > 0 ? (
            <Row
              label={`${publicNum(q.weekdayNights)} ${t("bk_nights_weekday")}`}
              value={publicSar(q.weekdayNights * (q.nightlyRate ?? 0), locale)}
            />
          ) : null}
          {q.weekendNights > 0 ? (
            <Row
              label={`${publicNum(q.weekendNights)} ${t("bk_nights_weekend")}`}
              value={publicSar(q.weekendNights * (q.weekendRate ?? q.nightlyRate ?? 0), locale)}
            />
          ) : null}
          <div className="mt-1 flex items-baseline justify-between font-bold">
            <span>{t("bk_total")}</span>
            <span className="tabular-nums">{publicSar(q.total, locale)}</span>
          </div>
        </div>
      ) : null}

      <label className="flex flex-col gap-1.5 text-sm">
        {t("bk_name")}
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          autoComplete="name"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        {t("bk_phone")}
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          dir="ltr"
          inputMode="tel"
          maxLength={15}
          required
          autoComplete="tel"
          placeholder="05xxxxxxxx"
          aria-invalid={phoneError ? true : undefined}
        />
        {phoneError ? <span className="text-xs text-destructive">{phoneError}</span> : null}
      </label>
      {maxGuests ? (
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5 text-brass" aria-hidden />
            {t("bk_guests")} ({t("bk_max")} {publicNum(maxGuests)})
          </span>
          <Input
            value={guests}
            onChange={(e) => setGuests(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            max={maxGuests}
          />
        </label>
      ) : null}

      <Button type="submit" disabled={!canBook || book.isPending}>
        <CalendarCheck className="size-4" />
        {book.isPending ? t("bk_sending") : t("bk_submit")}
      </Button>

      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {checkinTime || checkoutTime ? (
          <li className="flex items-center gap-1.5">
            <Clock className="size-3.5" aria-hidden />
            {t("bk_checkin")} {checkinTime?.slice(0, 5)} · {t("bk_checkout")}{" "}
            {checkoutTime?.slice(0, 5)}
          </li>
        ) : null}
        {minNights > 1 ? (
          <li>
            {t("bk_min_nights")} {publicNum(minNights)}
          </li>
        ) : null}
        <li>
          {freeCancelDays > 0
            ? `${t("bk_free_cancel")} ${publicNum(freeCancelDays)} ${t("bk_days_before")}`
            : t("bk_no_free_cancel")}
        </li>
        <li>{t("bk_pay_note")}</li>
        {tourismLicenseNo ? (
          <li dir="auto">
            {t("bk_license")}: <span dir="ltr">{tourismLicenseNo}</span>
          </li>
        ) : null}
      </ul>

      {houseRules ? (
        <div className="border-t border-border pt-3">
          <p className="mb-1 text-xs font-semibold">{t("bk_rules")}</p>
          <p className="text-xs leading-relaxed whitespace-pre-line text-muted-foreground">
            {houseRules}
          </p>
        </div>
      ) : null}
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
