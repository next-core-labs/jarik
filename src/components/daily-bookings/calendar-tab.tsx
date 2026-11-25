import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarX, ChevronLeft, ChevronRight, LogOut, Phone } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import {
  bookingsInRange,
  monthGrid,
  monthLabel,
  monthOf,
  monthTotals,
  rangeHasOccupied,
  rangeToStay,
  selectedRange,
  shiftMonth,
  WEEKDAYS,
  type CalendarBooking,
} from "@/lib/booking-calendar";
import { bookingStatusLabel, isBookingStatus, stayLabel } from "@/lib/bookings";
import { todayRiyadh } from "@/lib/dates";
import { arNum, shortDate } from "@/lib/format";
import { phoneHref } from "@/lib/market";
import { cn } from "@/lib/utils";

import { BOOKINGS_KEY, unitLabel, type BookingRow, type DailyListing } from "./model";

/**
 * تقويم الحجز اليومي: شهر كامل يرى فيه المكتب المشغول والمعلّق والمحجوب والحرّ بنظرة واحدة،
 * ويحجب مدى بالنقر عليه بدل كتابة تاريخين.
 *
 * الليلة لا اليوم: الخليّة تعرض من ينام فيها، ويوم الخروج يظهر كخروج لا كمشغول — كما تحسبها
 * القاعدة تمامًا، فلا يردّ المكتب ضيفًا على ليلة حرّة.
 */
export function CalendarTab({
  bookings,
  listings,
  /** جوال الضيف ورقمه للمكتب المتعاقد معه؛ المالك يرى حجوزات وحدته بلا بيانات تواصل الضيف. */
  showGuestContact = true,
}: {
  bookings: BookingRow[];
  listings: DailyListing[];
  showGuestContact?: boolean;
}) {
  const queryClient = useQueryClient();
  const today = todayRiyadh();
  const [month, setMonth] = useState(() => monthOf(today));
  // "" = كل الإعلانات. الحجب يحتاج إعلانًا بعينه، والعرض لا.
  const [unitId, setUnitId] = useState("");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [second, setSecond] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const scoped: CalendarBooking[] = useMemo(
    () =>
      bookings
        .filter((b) => (unitId ? b.unit_id === unitId : true))
        .map((b) => ({
          id: b.id,
          unit_id: b.unit_id,
          from_date: b.from_date,
          to_date: b.to_date,
          status: b.status,
          guest_name: b.guest_name,
          unit_label: b.unit_label,
          nights: b.nights,
        })),
    [bookings, unitId],
  );

  const days = useMemo(() => monthGrid(month, scoped, today), [month, scoped, today]);
  const totals = useMemo(() => monthTotals(days), [days]);
  const range = selectedRange(anchor, second);
  const inRange = range ? bookingsInRange(scoped, range) : [];
  const occupied = range ? rangeHasOccupied(scoped, range) : false;

  const pickDay = (date: string) => {
    if (!anchor || second) {
      setAnchor(date);
      setSecond(null);
      return;
    }
    setSecond(date);
  };
  const clear = () => {
    setAnchor(null);
    setSecond(null);
  };

  const block = useMutation({
    mutationFn: async () => {
      if (!range) throw new Error("اختر الأيام من التقويم");
      if (!unitId) throw new Error("اختر الإعلان أولًا — الحجب يكون على وحدة بعينها");
      const stay = rangeToStay(range);
      const { error } = await supabase.from("bookings").insert({
        unit_id: unitId,
        stay: `[${stay.from},${stay.to})`,
        // يحتسبها المحرّك في القاعدة؛ تُرسل لتمرير قيد NOT NULL.
        nights: 1,
        total_amount: 0,
        status: "blocked",
        staff_note: note.trim() || null,
      });
      // قيد EXCLUDE يرفض الحجب فوق حجز قائم — ورسالته تُترجم هنا لتُفهم.
      if (error) {
        throw new Error(
          error.code === "23P01"
            ? "تتعارض هذه الأيام مع حجز أو حجب قائم على الوحدة"
            : error.message,
        );
      }
    },
    onSuccess: async () => {
      toast.success("حُجبت الأيام — لن تستقبل حجوزات فيها");
      setNote("");
      clear();
      await queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حجب الأيام")),
  });

  const release = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("bookings")
        .update({ status: "cancelled" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("رُفع الحجب — تحرّرت الأيام للحجز");
      await queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر رفع الحجب")),
  });

  if (listings.length === 0) {
    return (
      <Card className="shadow-deed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          {showGuestContact
            ? "لا إعلانات حجز يومي بعد — أضف إعلانًا ليظهر تقويمه هنا."
            : "لا وحدة من وحداتك معروضة للحجز اليومي بعد — يضيفها المكتب الذي يديرها."}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="shadow-deed">
        <CardHeader className="gap-3 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <Button
                size="icon"
                variant="outline"
                aria-label="الشهر السابق"
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <ChevronRight className="size-4" />
              </Button>
              <CardTitle className="min-w-[150px] text-center text-base">
                {monthLabel(month)}
              </CardTitle>
              <Button
                size="icon"
                variant="outline"
                aria-label="الشهر التالي"
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <ChevronLeft className="size-4" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="ms-1"
                onClick={() => setMonth(monthOf(today))}
              >
                هذا الشهر
              </Button>
            </div>
            <div className="min-w-[200px]">
              <Select
                value={unitId || "all"}
                onValueChange={(v) => setUnitId(v === "all" ? "" : v)}
              >
                <SelectTrigger aria-label="الإعلان">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل الإعلانات</SelectItem>
                  {listings.map((l) => (
                    <SelectItem key={l.unit_id} value={l.unit_id}>
                      {unitLabel(l)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {`${arNum(totals.confirmedNights)} ليلة مؤكَّدة · ${arNum(totals.pendingNights)} بانتظار التأكيد · ${arNum(totals.blockedNights)} محجوبة · ${arNum(totals.freeNights)} حرّة`}
            {unitId ? ` · الإشغال ${arNum(totals.occupancyPct)}٪` : null}
          </p>
        </CardHeader>

        <CardContent className="flex flex-col gap-3">
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {WEEKDAYS.map((d) => (
              <div key={d} className="py-1">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {days.map((d) => {
              const selected =
                range !== null && d.date >= range.from && d.date <= range.to && d.inMonth;
              const busy = d.confirmed.length + d.pending.length + d.blocked.length;
              return (
                <button
                  key={d.date}
                  type="button"
                  onClick={() => pickDay(d.date)}
                  aria-pressed={selected}
                  aria-label={`${shortDate(d.date)}${
                    busy === 0 ? " — حرّة" : d.confirmed.length > 0 ? " — مؤكَّد" : ""
                  }`}
                  className={cn(
                    "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border text-sm transition-colors",
                    d.inMonth
                      ? "border-border bg-card"
                      : "border-transparent text-muted-foreground/50",
                    d.isPast && "opacity-55",
                    d.isToday && "ring-2 ring-ring",
                    selected && "border-foreground bg-muted",
                    d.inMonth && "hover:bg-muted",
                  )}
                >
                  <span className={cn("tabular-nums", d.isToday && "font-bold")}>
                    {arNum(Number(d.date.slice(8)))}
                  </span>
                  <span className="flex h-1.5 items-center gap-0.5">
                    {d.confirmed.length > 0 ? <Dot className="bg-success" /> : null}
                    {d.pending.length > 0 ? <Dot className="bg-warning" /> : null}
                    {d.blocked.length > 0 ? <Dot className="bg-muted-foreground" /> : null}
                    {busy === 0 && d.checkouts.length > 0 ? (
                      <LogOut className="size-3 text-muted-foreground" aria-hidden />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <Legend className="bg-success">مؤكَّد</Legend>
            <Legend className="bg-warning">بانتظار التأكيد</Legend>
            <Legend className="bg-muted-foreground">محجوب</Legend>
            <li className="flex items-center gap-1.5">
              <LogOut className="size-3" aria-hidden />
              خروج (الليلة حرّة)
            </li>
          </ul>
        </CardContent>
      </Card>

      {range ? (
        <Card className="shadow-deed">
          <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
            <CardTitle className="text-base">
              {range.from === range.to
                ? shortDate(range.from)
                : `${shortDate(range.from)} ← ${shortDate(range.to)}`}
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={clear}>
              إلغاء التحديد
            </Button>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {inRange.length === 0 ? (
              <p className="text-sm text-muted-foreground">لا حجوزات في هذه الأيام.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {inRange.map((b) => {
                  const tel = showGuestContact
                    ? phoneHref(bookings.find((r) => r.id === b.id)?.guest_phone ?? null)
                    : null;
                  return (
                    <li
                      key={b.id}
                      className="flex flex-wrap items-center justify-between gap-2 border border-border bg-card p-3"
                    >
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {b.status === "blocked" ? "أيام محجوبة" : (b.guest_name ?? "ضيف")}
                          <Badge
                            variant={
                              b.status === "confirmed"
                                ? "success"
                                : b.status === "pending"
                                  ? "warning"
                                  : "secondary"
                            }
                          >
                            {isBookingStatus(b.status) ? bookingStatusLabel(b.status) : b.status}
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {b.unit_label} · {stayLabel(b.from_date, b.to_date)} · {arNum(b.nights)}{" "}
                          ليلة
                        </span>
                      </div>
                      <div className="flex gap-2">
                        {b.status === "blocked" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={release.isPending}
                            onClick={() => release.mutate(b.id)}
                          >
                            <CalendarX className="size-4" />
                            رفع الحجب
                          </Button>
                        ) : null}
                        {tel ? (
                          <Button size="sm" variant="outline" asChild>
                            <a href={tel}>
                              <Phone className="size-4" />
                              اتصال
                            </a>
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* الحجب على الأيام المختارة — ممنوع فوق ليلة مشغولة، فالقاعدة ترفضه أصلًا. */}
            <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
              <div className="flex min-w-[200px] flex-1 flex-col gap-1.5">
                <Label className="text-xs" htmlFor="block-note">
                  سبب الحجب (اختياري)
                </Label>
                <Input
                  id="block-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={300}
                  placeholder="صيانة، استخدام خاص…"
                />
              </div>
              <Button
                disabled={block.isPending || occupied || !unitId}
                onClick={() => block.mutate()}
              >
                <CalendarX className="size-4" />
                {range.from === range.to
                  ? "احجب هذا اليوم"
                  : `احجب ${arNum(countDays(range))} أيام`}
              </Button>
            </div>
            {!unitId ? (
              <p className="text-xs text-muted-foreground">
                اختر إعلانًا من القائمة أعلاه — الحجب يكون على وحدة بعينها لا على كل الإعلانات.
              </p>
            ) : occupied ? (
              <p className="text-xs text-muted-foreground">
                فيها حجز قائم؛ ألغِ الحجز أو اختر أيامًا أخرى.
              </p>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground">
          انقر يومًا لرؤية حجوزاته، ثم يومًا آخر لتحديد مدى وحجبه.
        </p>
      )}
    </div>
  );
}

function countDays(range: { from: string; to: string }): number {
  return Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000) + 1;
}

function Dot({ className }: { className: string }) {
  return <span className={cn("size-1.5 rounded-full", className)} aria-hidden />;
}

function Legend({ className, children }: { className: string; children: string }) {
  return (
    <li className="flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", className)} aria-hidden />
      {children}
    </li>
  );
}
