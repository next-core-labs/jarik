import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck, ImageOff, MapPin, MessageCircle, Phone } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { ReviewForm, ReviewShown } from "@/components/booking-review";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { arCount, sar, shortDate } from "@/lib/format";
import { bookingStatusLabel, isBookingStatus, splitMyBookings, stayLabel } from "@/lib/bookings";
import { phoneHref, whatsappHref } from "@/lib/market";
import { mediaUrl } from "@/lib/unit-photos";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/my-bookings")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "حجوزاتي — جارك" },
      { name: "description", content: "حجوزاتك اليومية وحالتها، وتقييم الوحدة بعد انتهاء الحجز." },
    ],
  }),
  component: MyBookings,
});

type MyBooking = {
  id: string;
  unit_id: string;
  status: string;
  from_date: string;
  to_date: string;
  nights: number;
  total_amount: number;
  guests: number | null;
  created_at: string;
  unit_name: string | null;
  unit_number: string | null;
  unit_type: string | null;
  district: string | null;
  city: string | null;
  cover_path: string | null;
  office_name: string | null;
  office_phone: string | null;
  office_whatsapp: string | null;
  listed: boolean;
  my_rating: number | null;
  my_comment: string | null;
  host_rating: number | null;
  host_comment: string | null;
};

const QUERY_KEY = ["my-bookings"] as const;

function MyBookings() {
  const queryClient = useQueryClient();
  const bookings = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async (): Promise<MyBooking[]> => {
      // my_bookings() تُرجع حجوزات هذا الحساب وحده (guest_user_id)، مع اسم الوحدة والمكتب.
      const { data, error } = await supabase.rpc("my_bookings");
      if (error) throw error;
      return (data ?? []) as MyBooking[];
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  const { toRate, upcoming, past } = splitMyBookings(bookings.data ?? []);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="حجوزاتي"
        subtitle="حجوزاتك اليومية وحالتها. بعد انتهاء الحجز قيّم الوحدة، ويقيّمك المكتب كذلك."
        action={
          <Button size="sm" variant="outline" asChild>
            <Link to="/stays">احجز وحدة</Link>
          </Button>
        }
      />

      {bookings.isLoading ? (
        <Skeleton className="h-48" />
      ) : bookings.error ? (
        <p className="text-sm text-destructive">تعذّر تحميل حجوزاتك — حدّث الصفحة.</p>
      ) : (bookings.data ?? []).length === 0 ? (
        <Card className="shadow-deed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <CalendarCheck className="size-10 text-muted-foreground opacity-50" aria-hidden />
            <p className="text-sm text-muted-foreground">
              لا حجوزات على حسابك بعد. احجز وأنت داخل بحسابك ليظهر الحجز هنا وتتابع حالته.
            </p>
            <Button asChild>
              <Link to="/stays">تصفّح وحدات الحجز اليومي</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <Section title="بانتظار تقييمك" rows={toRate} onReviewed={refresh} />
          <Section title="القادمة والجارية" rows={upcoming} onReviewed={refresh} />
          <Section title="السابقة" rows={past} onReviewed={refresh} />
        </>
      )}
    </div>
  );
}

function Section({
  title,
  rows,
  onReviewed,
}: {
  title: string;
  rows: MyBooking[];
  onReviewed: () => Promise<void>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-muted-foreground">{title}</h2>
      {rows.map((b) => (
        <BookingCard key={b.id} b={b} onReviewed={onReviewed} />
      ))}
    </section>
  );
}

function BookingCard({ b, onReviewed }: { b: MyBooking; onReviewed: () => Promise<void> }) {
  const title = b.unit_name?.trim() || b.unit_type || `وحدة ${b.unit_number ?? ""}`.trim();
  const place = [b.district ? `حي ${b.district}` : null, b.city].filter(Boolean).join(" · ");
  const tel = phoneHref(b.office_phone);
  const wa = whatsappHref(
    b.office_whatsapp ?? b.office_phone,
    `السلام عليكم، بخصوص حجزي في «${title}» من ${b.from_date} إلى ${b.to_date}.`,
  );
  // المكتب ما زال طرفًا في الحجز ما دام قائمًا؛ بعد الرفض أو الإلغاء لا داعي لأزرار الاتصال.
  const live = b.status === "pending" || b.status === "confirmed";

  return (
    <Card className="shadow-deed">
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex gap-3">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
            {b.cover_path ? (
              <img
                src={mediaUrl(b.cover_path)}
                alt=""
                loading="lazy"
                className="size-full object-cover"
              />
            ) : (
              <ImageOff className="size-6 text-muted-foreground opacity-50" aria-hidden />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="min-w-0 text-base font-bold break-words">{title}</h3>
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
            {place ? (
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" aria-hidden />
                {place}
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground tabular-nums">
              {stayLabel(b.from_date, b.to_date)} ·{" "}
              {arCount(b.nights, {
                one: "ليلة واحدة",
                two: "ليلتان",
                few: "ليالٍ",
                many: "ليلة",
              })}
              {b.guests
                ? ` · ${arCount(b.guests, { one: "ضيف واحد", two: "ضيفان", few: "ضيوف", many: "ضيفًا" })}`
                : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-baseline justify-between gap-2 border-t border-border pt-3">
          <span className="text-sm font-semibold tabular-nums">{sar(Number(b.total_amount))}</span>
          <span className="text-xs text-muted-foreground">
            {b.office_name ? `${b.office_name} · ` : ""}طُلب {shortDate(b.created_at)}
          </span>
        </div>

        {b.status === "pending" ? (
          <p className="rounded-sm bg-muted/60 px-3 py-2 text-xs">
            طلبك عند المكتب. التواريخ محجوزة لك مؤقتًا حتى يؤكّد أو يعتذر، ويصلك إشعار بقراره.
          </p>
        ) : null}

        {b.status === "completed" ? (
          <div className="flex flex-col gap-2">
            {b.my_rating ? (
              <ReviewShown label="تقييمك للوحدة" rating={b.my_rating} comment={b.my_comment} />
            ) : (
              <ReviewForm bookingId={b.id} direction="guest_to_unit" onDone={onReviewed} />
            )}
            {b.host_rating ? (
              <ReviewShown
                label="تقييم المكتب لك"
                rating={b.host_rating}
                comment={b.host_comment}
              />
            ) : null}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {b.listed ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/unit/$unitId" params={{ unitId: b.unit_id }}>
                {b.status === "completed" ? "احجزها مرة أخرى" : "صفحة الوحدة"}
              </Link>
            </Button>
          ) : null}
          {live && wa ? (
            <Button size="sm" variant="outline" asChild>
              <a href={wa} target="_blank" rel="noopener noreferrer">
                <MessageCircle className="size-4" />
                واتساب المكتب
              </a>
            </Button>
          ) : null}
          {live && tel ? (
            <Button size="sm" variant="outline" asChild>
              <a href={tel}>
                <Phone className="size-4" />
                اتصل بالمكتب
              </a>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
