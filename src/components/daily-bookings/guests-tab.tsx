import { useMemo, useState } from "react";
import { Download, MessageCircle, Phone, Search, Users } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { stayLabel } from "@/lib/bookings";
import { summarizeGuests } from "@/lib/daily-listings";
import { todayRiyadh } from "@/lib/dates";
import { exportToExcel } from "@/lib/export-excel";
import { arCount, sar } from "@/lib/format";
import { normalizeArabic, phoneHref, whatsappHref } from "@/lib/market";
import { toLatinDigits } from "@/lib/saudi-id";

import type { BookingRow } from "./model";

/**
 * عملاء الحجز اليومي: كل ضيف مرة واحدة، بعدد إقاماته وما دفعه وإقامته القادمة — مبنية من
 * الحجوزات نفسها، فلا سجل ثانٍ يُحدَّث ولا يختلف عنها. منفصلة عن «المستأجرون والعقود».
 */
export function GuestsTab({ bookings }: { bookings: BookingRow[] }) {
  const [q, setQ] = useState("");
  const guests = useMemo(() => summarizeGuests(bookings, todayRiyadh()), [bookings]);

  const shown = useMemo(() => {
    const text = normalizeArabic(q.trim());
    const digits = toLatinDigits(q).replace(/\D/g, "");
    if (!text) return guests;
    return guests.filter(
      (g) =>
        normalizeArabic(g.name).includes(text) ||
        (digits.length >= 3 && toLatinDigits(g.phone).replace(/\D/g, "").includes(digits)),
    );
  }, [guests, q]);

  if (guests.length === 0) {
    return (
      <Card className="shadow-deed">
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <Users className="size-10 text-muted-foreground opacity-50" aria-hidden />
          <p className="max-w-md text-sm text-muted-foreground">
            لا عملاء بعد. كل ضيف يطلب حجزًا يُضاف هنا تلقائيًا باسمه وجواله وسجل إقاماته.
          </p>
        </CardContent>
      </Card>
    );
  }

  const exportGuests = () =>
    exportToExcel(
      `عملاء-الحجز-اليومي-${todayRiyadh()}.xlsx`,
      "عملاء الحجز اليومي",
      guests.map((g) => ({
        الاسم: g.name,
        الجوال: g.phone,
        الطلبات: g.requests,
        الإقامات: g.stays,
        الليالي: g.nights,
        "إجمالي المدفوع (ر.س)": g.spent,
        "آخر إقامة": g.lastStay?.from ?? "",
        "الإقامة القادمة": g.nextStay?.from ?? "",
        الإعلانات: g.units.join("، "),
      })),
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search
            className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو الجوال"
            aria-label="ابحث في العملاء"
            className="ps-9"
          />
        </div>
        <Button size="sm" variant="outline" onClick={exportGuests}>
          <Download className="size-4" />
          تصدير Excel
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {arCount(guests.length, { one: "عميل واحد", two: "عميلان", few: "عملاء", many: "عميلًا" })}
        {" · "}
        {arCount(guests.filter((g) => g.stays > 1).length, {
          one: "عميل واحد",
          two: "عميلان",
          few: "عملاء",
          many: "عميلًا",
        })}{" "}
        عادوا أكثر من مرة
      </p>

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">لا عميل يطابق بحثك.</p>
      ) : (
        shown.map((g) => {
          const tel = phoneHref(g.phone);
          const wa = whatsappHref(g.phone);
          return (
            <Card key={g.key} className="shadow-deed">
              <CardContent className="flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{g.name || "ضيف"}</p>
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {g.phone}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {g.stays > 1 ? <Badge>عميل متكرر</Badge> : null}
                    {g.pending > 0 ? (
                      <Badge variant="outline" className="border-brass text-foreground">
                        طلب بانتظارك
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <dl className="grid grid-cols-3 gap-2 text-center">
                  <Stat
                    label="الإقامات"
                    value={
                      g.stays === 0
                        ? "—"
                        : arCount(g.stays, {
                            one: "واحدة",
                            two: "اثنتان",
                            few: "إقامات",
                            many: "إقامة",
                          })
                    }
                  />
                  <Stat
                    label="الليالي"
                    value={
                      g.nights === 0
                        ? "—"
                        : arCount(g.nights, {
                            one: "واحدة",
                            two: "ليلتان",
                            few: "ليالٍ",
                            many: "ليلة",
                          })
                    }
                  />
                  <Stat label="المدفوع" value={g.spent > 0 ? sar(g.spent) : "—"} />
                </dl>

                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  {g.nextStay ? (
                    <p>
                      <span className="font-medium text-foreground">قادم:</span>{" "}
                      {stayLabel(g.nextStay.from, g.nextStay.to)} · {g.nextStay.unit}
                    </p>
                  ) : null}
                  {g.lastStay ? (
                    <p>
                      آخر إقامة: {stayLabel(g.lastStay.from, g.lastStay.to)} · {g.lastStay.unit}
                    </p>
                  ) : null}
                  {g.stays === 0 && !g.nextStay ? (
                    <p>
                      {g.cancelled > 0 && g.cancelled === g.requests
                        ? "طلباته أُلغيت أو رُفضت — لم يُقم بعد."
                        : "طلب حجزًا ولم يُقم بعد."}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {tel ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={tel}>
                        <Phone className="size-4" />
                        اتصال
                      </a>
                    </Button>
                  ) : null}
                  {wa ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={wa} target="_blank" rel="noreferrer">
                        <MessageCircle className="size-4" />
                        واتساب
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm bg-muted/40 px-2 py-2">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
