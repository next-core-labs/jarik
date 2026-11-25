import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BedDouble, CalendarCheck, CalendarClock, Wallet } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { CalendarTab } from "@/components/daily-bookings/calendar-tab";
import { useDailyListings, useOfficeBookings } from "@/components/daily-bookings/model";
import { StatCard } from "@/components/stat-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bookingStatusLabel, isBookingStatus, occupiesDates, stayLabel } from "@/lib/bookings";
import { bookingStats } from "@/lib/daily-listings";
import { todayRiyadh } from "@/lib/dates";
import { arNum, sar } from "@/lib/format";

import type { BookingRow, DailyListing } from "@/components/daily-bookings/model";

/**
 * لوحة الحجز اليومي للمالك — نفس لوحة المكتب من حيث ما يُرى، وتختلف فيما يُفعل:
 *
 * المالك يرى كل حجز على وحداته ويحجب أيامه لاستخدامه الخاص ويرفع الحجب. ولا يؤكّد حجز ضيف ولا
 * يرفضه ولا يسعّر الإعلان: الوحدة تُعرض في السوق باتفاقية إدارة، والتعاقد مع الضيف وتسعير الليلة
 * فعل المكتب المتعاقد. وليس هذا اختيار واجهة: سياسات القاعدة (20261126110000) تمنعه من لمس صفّ
 * ليس حجبًا، فالشاشة تقول ما تقوله القاعدة لا أكثر.
 *
 * البيانات من نفس خطّافَي لوحة المكتب: RLS وحدها تحصر ما يعود للمالك في وحداته — لا فلترة في
 * الواجهة تُنسى يومًا فتكشف حجوزات غيره.
 */

export const Route = createFileRoute("/_authenticated/owner/bookings")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الحجز اليومي — جارك" },
      {
        name: "description",
        content: "حجوزات وحداتك بالليلة: التقويم، الحجوزات القادمة، وحجب أيامك الخاصة.",
      },
    ],
  }),
  component: OwnerBookings,
});

const TABS = ["calendar", "bookings"] as const;
type Tab = (typeof TABS)[number];

function OwnerBookings() {
  const [tab, setTab] = useState<Tab>("calendar");
  const bookings = useOfficeBookings();
  const listings = useDailyListings();
  const today = todayRiyadh();

  const rows = useMemo(() => bookings.data ?? [], [bookings.data]);
  const stats = useMemo(() => bookingStats(rows, today), [rows, today]);
  const myListings = listings.data ?? [];
  const liveCount = myListings.filter((l) => l.live).length;

  const loading = bookings.isLoading || listings.isLoading;
  const failed = bookings.error || listings.error;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="الحجز اليومي"
        subtitle="حجوزات وحداتك بالليلة كما يراها المكتب الذي يديرها — ولك أن تحجب أيامك الخاصة."
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : failed ? (
        <p className="text-sm text-destructive">تعذّر تحميل حجوزاتك — حدّث الصفحة.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={CalendarCheck}
              label="حجوزات قادمة"
              value={stats.upcoming}
              hint={
                stats.arrivingToday > 0 ? `${arNum(stats.arrivingToday)} يدخلون اليوم` : undefined
              }
            />
            <StatCard icon={CalendarClock} label="بانتظار تأكيد المكتب" value={stats.pending} />
            <StatCard
              icon={BedDouble}
              label="وحداتك المعروضة"
              value={liveCount}
              hint={`من ${arNum(myListings.length)}`}
            />
            {/* إجمالي ما حُجزت به الليالي، لا صافي المالك: عمولة المكتب تُحسب في اتفاقية الإدارة. */}
            <StatCard
              icon={Wallet}
              label="إيراد وحداتك هذا الشهر"
              value={sar(stats.monthRevenue)}
              hint="قبل عمولة المكتب"
            />
          </div>

          <Tabs
            value={tab}
            onValueChange={(v) => setTab(v === "bookings" ? "bookings" : "calendar")}
            dir="rtl"
          >
            <TabsList className="w-full">
              <TabsTrigger value="calendar" className="flex-1 sm:flex-none">
                التقويم
              </TabsTrigger>
              <TabsTrigger value="bookings" className="flex-1 sm:flex-none">
                الحجوزات
              </TabsTrigger>
            </TabsList>
            <TabsContent value="calendar">
              <CalendarTab bookings={rows} listings={myListings} showGuestContact={false} />
            </TabsContent>
            <TabsContent value="bookings">
              <BookingsList bookings={rows} listings={myListings} today={today} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

/** الحجوزات القائمة على وحدات المالك: ما يشغل تاريخًا لم يمضِ، الأقرب دخولًا أولًا. */
function BookingsList({
  bookings,
  listings,
  today,
}: {
  bookings: BookingRow[];
  listings: DailyListing[];
  today: string;
}) {
  const rows = bookings
    .filter((b) => isBookingStatus(b.status) && occupiesDates(b.status) && b.to_date > today)
    .sort((a, b) => a.from_date.localeCompare(b.from_date));

  if (listings.length === 0) {
    return (
      <Card className="shadow-deed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          لا وحدة من وحداتك معروضة للحجز اليومي بعد — يضيفها المكتب الذي يديرها.
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card className="shadow-deed">
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          لا حجوزات قادمة على وحداتك.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {rows.map((b) => (
        <Card key={b.id} className="shadow-deed">
          <CardHeader className="flex-row flex-wrap items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">{b.unit_label}</CardTitle>
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
          </CardHeader>
          <CardContent className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              {stayLabel(b.from_date, b.to_date)} · {arNum(b.nights)} ليلة
              {/* اسم الضيف بلا جواله: التعاقد مع الضيف للمكتب، والمالك يرى إشغال وحدته. */}
              {b.status !== "blocked" && b.guest_name ? ` · ${b.guest_name}` : ""}
              {b.status === "blocked" ? " · أيام محجوبة" : ""}
            </span>
            {b.status !== "blocked" ? (
              <span className="font-semibold tabular-nums">{sar(b.total_amount)}</span>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
