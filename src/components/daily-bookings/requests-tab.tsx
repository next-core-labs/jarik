import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, CalendarX, Check, Phone, Plus, X } from "lucide-react";
import { toast } from "sonner";

import { OfficeBookingReviews, useOfficeReviews } from "@/components/booking-review";
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
  bookingStatusLabel,
  isBookingStatus,
  occupiesDates,
  stayLabel,
  toDateInput,
} from "@/lib/bookings";
import { arCount, sar, shortDate } from "@/lib/format";
import { phoneHref } from "@/lib/market";
import { cn } from "@/lib/utils";

import { BOOKINGS_KEY, unitLabel, type BookingRow, type DailyListing } from "./model";

/** طلبات الحجز: تأكيدها أو رفضها، وحجب تواريخ لا يُراد استقبال حجوزات فيها. */
export function RequestsTab({
  bookings,
  listings,
  onAddListing,
}: {
  bookings: BookingRow[];
  listings: DailyListing[];
  onAddListing: () => void;
}) {
  const queryClient = useQueryClient();
  const [showAll, setShowAll] = useState(false);
  const { reviews, loaded: reviewsLoaded } = useOfficeReviews();
  // حجز انتهى وما زال ينتظر تقييم المكتب للضيف — يبقى في «النشطة» حتى يُقيَّم.
  const awaitsHostReview = (b: BookingRow) =>
    reviewsLoaded && b.status === "completed" && Boolean(b.guest_name) && !reviews.get(b.id)?.host;

  const setStatus = useMutation({
    mutationFn: async (input: { id: string; status: string; note?: string }) => {
      const { error } = await supabase
        .from("bookings")
        .update({ status: input.status, ...(input.note ? { staff_note: input.note } : {}) })
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: async (input) => {
      toast.success(
        input.status === "confirmed"
          ? "تم تأكيد الحجز — أبلغ الضيف"
          : input.status === "rejected"
            ? "رُفض الطلب وتحرّرت التواريخ"
            : input.status === "completed"
              ? "انتهى الحجز — قيّم الضيف"
              : "حُدِّثت حالة الحجز",
      );
      await queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["office-nav-pending-bookings"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الحجز")),
  });

  const rows = bookings.filter((b) =>
    showAll ? true : (isBookingStatus(b.status) && occupiesDates(b.status)) || awaitsHostReview(b),
  );
  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const enabledListings = listings.filter((l) => l.settings.enabled);

  return (
    <div className="flex flex-col gap-5">
      {pendingCount > 0 ? (
        <p className="rounded-lg border border-brass bg-brass/5 px-4 py-3 text-sm">
          <span className="font-semibold">
            {arCount(pendingCount, {
              one: "طلب واحد",
              two: "طلبان",
              few: "طلبات",
              many: "طلبًا",
            })}{" "}
            بانتظار تأكيدك.
          </span>{" "}
          التواريخ محجوزة مؤقتًا لهذه الطلبات، فرفض الطلب يحرّرها لغيره.
        </p>
      ) : null}

      <BlockDates listings={enabledListings} />

      {bookings.length > 0 ? (
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => setShowAll((v) => !v)}>
            {showAll ? "النشطة فقط" : "عرض الكل"}
          </Button>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <Card className="shadow-deed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarCheck className="size-10 text-muted-foreground opacity-50" aria-hidden />
            {listings.length === 0 ? (
              <>
                <p className="text-sm text-muted-foreground">
                  لا حجوزات بعد. أضف أول إعلان حجز يومي — بسعر الليلة ورقم رخصة الإيواء السياحي —
                  ليظهر في سوق الحجز اليومي ويستقبل الطلبات.
                </p>
                <Button size="sm" onClick={onAddListing}>
                  <Plus className="size-4" />
                  إعلان جديد
                </Button>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {bookings.length === 0
                  ? "لا حجوزات بعد. تصلك الطلبات هنا متى حجز ضيف أحد إعلاناتك."
                  : "لا حجوزات نشطة الآن."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        rows.map((b) => {
          const tel = phoneHref(b.guest_phone);
          return (
            <Card key={b.id} className="shadow-deed">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {b.status === "blocked" || !b.guest_name
                        ? `تواريخ محجوبة — ${b.unit_label}`
                        : `${b.guest_name} — ${b.unit_label}`}
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {/* stayLabel يكتب «١ ديسمبر → ٤ ديسمبر» بأرقام عربية كبقية السطر؛ الصيغة
                          الخام ISO كانت تنعكس فتُقرأ «الخروج → الدخول». */}
                      {stayLabel(b.from_date, b.to_date)} ·{" "}
                      {arCount(b.nights, {
                        one: "ليلة واحدة",
                        two: "ليلتان",
                        few: "ليالٍ",
                        many: "ليلة",
                      })}
                      {b.guests
                        ? ` · ${arCount(b.guests, { one: "ضيف واحد", two: "ضيفان", few: "ضيوف", many: "ضيفًا" })}`
                        : ""}{" "}
                      · طُلب {shortDate(b.created_at)}
                    </p>
                  </div>
                  <Badge
                    variant={
                      b.status === "confirmed"
                        ? "default"
                        : b.status === "pending"
                          ? "outline"
                          : "secondary"
                    }
                    className={cn(b.status === "pending" && "border-brass text-foreground")}
                  >
                    {isBookingStatus(b.status) ? bookingStatusLabel(b.status) : b.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {b.status !== "blocked" && b.guest_name ? (
                  <p className="text-sm font-semibold tabular-nums">{sar(b.total_amount)}</p>
                ) : null}
                {b.notes ? <p className="text-sm text-muted-foreground">{b.notes}</p> : null}
                {b.staff_note ? (
                  <p className="text-xs text-muted-foreground">ملاحظتك: {b.staff_note}</p>
                ) : null}
                {b.status === "completed" && b.guest_name && reviewsLoaded ? (
                  <OfficeBookingReviews bookingId={b.id} reviews={reviews} />
                ) : null}

                <div className="flex flex-wrap gap-2">
                  {b.status === "pending" ? (
                    <>
                      <Button
                        size="sm"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: b.id, status: "confirmed" })}
                      >
                        <Check className="size-4" />
                        تأكيد الحجز
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => {
                          const note = window.prompt("سبب الرفض (يظهر لك فقط):") ?? undefined;
                          setStatus.mutate({
                            id: b.id,
                            status: "rejected",
                            ...(note ? { note } : {}),
                          });
                        }}
                      >
                        <X className="size-4" />
                        رفض
                      </Button>
                    </>
                  ) : null}
                  {b.status === "confirmed" ? (
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ id: b.id, status: "completed" })}
                      >
                        انتهى الحجز
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => {
                          const note = window.prompt("سبب الإلغاء:") ?? undefined;
                          setStatus.mutate({
                            id: b.id,
                            status: "cancelled",
                            ...(note ? { note } : {}),
                          });
                        }}
                      >
                        إلغاء
                      </Button>
                    </>
                  ) : null}
                  {b.status === "blocked" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setStatus.isPending}
                      onClick={() => setStatus.mutate({ id: b.id, status: "cancelled" })}
                    >
                      <CalendarX className="size-4" />
                      إلغاء الحجب
                    </Button>
                  ) : null}
                  {tel ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={tel}>
                        <Phone className="size-4" />
                        <span dir="ltr">{b.guest_phone}</span>
                      </a>
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

/** حجب تواريخ: صيانة أو استخدام خاص — يُسجَّل كحجز بحالة «محجوب» فمصدر الإتاحة واحد. */
function BlockDates({ listings }: { listings: DailyListing[] }) {
  const queryClient = useQueryClient();
  const today = toDateInput(new Date());
  const [unitId, setUnitId] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [note, setNote] = useState("");

  const block = useMutation({
    mutationFn: async () => {
      if (!unitId) throw new Error("اختر الإعلان");
      if (!(from < to)) throw new Error("تاريخ الخروج يجب أن يكون بعد تاريخ الدخول");
      const { error } = await supabase.from("bookings").insert({
        unit_id: unitId,
        stay: `[${from},${to})`,
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
            ? "تتعارض هذه التواريخ مع حجز أو حجب قائم على الوحدة"
            : error.message,
        );
      }
    },
    onSuccess: async () => {
      toast.success("حُجبت التواريخ — لن تستقبل حجوزات فيها");
      setNote("");
      await queryClient.invalidateQueries({ queryKey: BOOKINGS_KEY });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حجب التواريخ")),
  });

  if (listings.length === 0) return null;

  return (
    <Card className="shadow-deed">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">حجب تواريخ</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <div className="col-span-2 flex min-w-[180px] flex-col gap-1.5">
          <Label className="text-xs">الإعلان</Label>
          <Select value={unitId} onValueChange={setUnitId}>
            <SelectTrigger aria-label="الإعلان">
              <SelectValue placeholder="اختر الإعلان" />
            </SelectTrigger>
            <SelectContent>
              {listings.map((l) => (
                <SelectItem key={l.unit_id} value={l.unit_id}>
                  {unitLabel(l)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label className="text-xs">من</Label>
          <Input type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label className="text-xs">إلى</Label>
          <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="col-span-2 flex min-w-[160px] flex-1 flex-col gap-1.5">
          <Label className="text-xs">السبب (اختياري)</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </div>
        <Button className="col-span-2" disabled={block.isPending} onClick={() => block.mutate()}>
          <Plus className="size-4" />
          {block.isPending ? "جارٍ الحجب…" : "احجب"}
        </Button>
      </CardContent>
    </Card>
  );
}
