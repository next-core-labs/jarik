import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CalendarCheck, CalendarClock, Megaphone, Plus, Wallet } from "lucide-react";

import { PageHeader } from "@/components/app-shell";
import { GuestsTab } from "@/components/daily-bookings/guests-tab";
import { DailyListingDialog } from "@/components/daily-bookings/listing-dialog";
import { ListingsTab } from "@/components/daily-bookings/listings-tab";
import {
  useDailyListings,
  useOfficeBookings,
  type DailyListing,
} from "@/components/daily-bookings/model";
import { RequestsTab } from "@/components/daily-bookings/requests-tab";
import { StatCard } from "@/components/stat-card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { bookingStats, summarizeGuests } from "@/lib/daily-listings";
import { todayRiyadh } from "@/lib/dates";
import { arNum, sar } from "@/lib/format";

/**
 * لوحة الحجز اليومي — مسار مستقل عن الإيجار السنوي: إعلاناته تُضاف من هنا (لا من «الأملاك
 * والوحدات»)، ورخصته رخصة إيواء سياحي، وعملاؤه ضيوف لا مستأجرون بعقود.
 */

const TABS = ["requests", "listings", "guests"] as const;
type Tab = (typeof TABS)[number];
const isTab = (v: unknown): v is Tab => TABS.includes(v as Tab);

export const Route = createFileRoute("/_authenticated/bookings")({
  staticData: { sitemap: false },
  validateSearch: (s: Record<string, unknown>): { tab?: Tab | undefined } => {
    const tab = s["tab"];
    return isTab(tab) && tab !== "requests" ? { tab } : {};
  },
  head: () => ({
    meta: [
      { title: "الحجز اليومي — جارك" },
      {
        name: "description",
        content: "لوحة الحجز اليومي: الحجوزات، إعلانات الوحدات ورخص الإيواء، وعملاء الحجز.",
      },
    ],
  }),
  component: Bookings,
});

function Bookings() {
  const navigate = useNavigate({ from: Route.fullPath });
  const tab: Tab = Route.useSearch().tab ?? "requests";
  const setTab = (next: Tab) =>
    void navigate({ search: next === "requests" ? {} : { tab: next }, replace: true });

  const bookings = useOfficeBookings();
  const listings = useDailyListings();
  const [dialog, setDialog] = useState<{ open: boolean; listing: DailyListing | null }>({
    open: false,
    listing: null,
  });
  const addListing = () => setDialog({ open: true, listing: null });

  const today = todayRiyadh();
  const stats = useMemo(() => bookingStats(bookings.data ?? [], today), [bookings.data, today]);
  const guestCount = useMemo(
    () => summarizeGuests(bookings.data ?? [], today).length,
    [bookings.data, today],
  );
  const liveCount = (listings.data ?? []).filter((l) => l.live).length;
  // رخصة آخر إعلان تُقترح في الجديد: مكتب برخصة واحدة لا يعيد كتابتها لكل وحدة.
  const suggestedLicense = (listings.data ?? [])
    .map((l) => l.settings.tourism_license_no?.trim())
    .find(Boolean);

  const loading = bookings.isLoading || listings.isLoading;
  const failed = bookings.error || listings.error;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="الحجز اليومي"
        subtitle="لوحة مستقلة عن الإيجار السنوي: إعلاناتك ورخصة الإيواء، طلبات الحجز، وعملاؤك."
        action={
          <Button size="sm" onClick={addListing}>
            <Plus className="size-4" />
            إعلان جديد
          </Button>
        }
      />

      {loading ? (
        <Skeleton className="h-64" />
      ) : failed ? (
        <p className="text-sm text-destructive">تعذّر تحميل لوحة الحجز اليومي — حدّث الصفحة.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={CalendarClock}
              label="طلبات بانتظارك"
              value={stats.pending}
              tone={stats.pending > 0 ? "warn" : "default"}
            />
            <StatCard
              icon={CalendarCheck}
              label="حجوزات قادمة"
              value={stats.upcoming}
              hint={
                stats.arrivingToday > 0 ? `${arNum(stats.arrivingToday)} يدخلون اليوم` : undefined
              }
            />
            <StatCard
              icon={Megaphone}
              label="إعلانات منشورة"
              value={liveCount}
              hint={`من ${arNum((listings.data ?? []).length)}`}
            />
            <StatCard icon={Wallet} label="إيراد هذا الشهر" value={sar(stats.monthRevenue)} />
          </div>

          <Tabs value={tab} onValueChange={(v) => isTab(v) && setTab(v)} dir="rtl">
            <TabsList className="w-full">
              <TabsTrigger value="requests" className="flex-1 sm:flex-none">
                الحجوزات
                {stats.pending > 0 ? <Count n={stats.pending} /> : null}
              </TabsTrigger>
              <TabsTrigger value="listings" className="flex-1 sm:flex-none">
                الإعلانات
                <Count n={(listings.data ?? []).length} muted />
              </TabsTrigger>
              <TabsTrigger value="guests" className="flex-1 sm:flex-none">
                العملاء
                <Count n={guestCount} muted />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="requests">
              <RequestsTab
                bookings={bookings.data ?? []}
                listings={listings.data ?? []}
                onAddListing={addListing}
              />
            </TabsContent>
            <TabsContent value="listings">
              <ListingsTab
                listings={listings.data ?? []}
                onAdd={addListing}
                onEdit={(listing) => setDialog({ open: true, listing })}
              />
            </TabsContent>
            <TabsContent value="guests">
              <GuestsTab bookings={bookings.data ?? []} />
            </TabsContent>
          </Tabs>
        </>
      )}

      <DailyListingDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog((d) => ({ ...d, open }))}
        listing={dialog.listing}
        suggestedLicense={suggestedLicense}
      />
    </div>
  );
}

function Count({ n, muted = false }: { n: number; muted?: boolean }) {
  if (n <= 0) return null;
  return (
    <span
      className={
        muted
          ? "rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
          : "rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-medium text-destructive-foreground"
      }
    >
      {arNum(n)}
    </span>
  );
}
