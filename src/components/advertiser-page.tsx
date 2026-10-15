import { Link } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import { MapPin, MessageCircle, Phone, Search } from "lucide-react";

import { Avatar, ListingRow } from "@/components/listing-row";
import { ArchEmptyState, SquareLogo, VerifiedMark } from "@/components/public/identity";
import { SiteHeader, bandPatternStyle } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { arCount, arNum } from "@/lib/format";
import {
  defaultFilters,
  filterListings,
  phoneHref,
  sortListings,
  whatsappHref,
  type Listing,
  type SortKey,
} from "@/lib/market";

export type AdvertiserPageData = {
  kind: "owner" | "office";
  name: string;
  imageUrl: string | null;
  bannerUrl: string | null;
  /** «نبذة تعريفية» */
  bio: string | null;
  areas?: string | null;
  propertyTypes?: string | null;
  licenseNo?: string | null;
  location?: string | null;
  /** For an owner: the office that publishes the page. */
  publishedBy?: string | null;
  phone: string | null;
  whatsapp: string | null;
  /** متوسط تقييم المستأجرين لصيانة هذا المكتب (لا يظهر إلا للمكاتب الموثّقة). */
  avgRating?: number | null;
  ratingsCount?: number | null;
};

const offersCount = (n: number) =>
  arCount(n, { one: "عرض واحد", two: "عرضان", few: "عروض", many: "عرضًا" });

/** Public page of an office or an owner: ink cover band, identity strip, and their active offers. */
export function AdvertiserPage({
  page,
  listings,
}: {
  page: AdvertiserPageData;
  listings: Listing[];
}) {
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SortKey>("newest");
  const shown = useMemo(
    () => sortListings(filterListings(listings, { ...defaultFilters, text }), sort),
    [listings, text, sort],
  );
  const tel = phoneHref(page.phone);
  const wa = whatsappHref(
    page.whatsapp ?? page.phone,
    `مرحبًا ${page.name}، أستفسر عن عروضكم في جارك`,
  );
  const isOffice = page.kind === "office";
  // office_pages_public only lists offices the platform has verified; owners carry no mark of
  // their own (the verification belongs to the office that publishes them).
  const verified = isOffice;
  const showRating = page.avgRating != null && (page.ratingsCount ?? 0) >= 3;
  const idLine = [
    isOffice ? "مكتب عقاري" : "مالك",
    page.licenseNo ? `فال ${page.licenseNo}` : null,
    page.location,
  ]
    .filter(Boolean)
    .join(" · ");
  const hasAbout = Boolean(
    page.bio || page.areas || page.propertyTypes || page.location || page.licenseNo,
  );

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      {/* Cover: the office's own banner when it has one, otherwise the ink band with the oversized
          symbol — the same ink top as the cards in the offices directory. */}
      <section
        aria-hidden
        className="relative h-32 bg-foreground bg-cover bg-center md:h-44"
        style={page.bannerUrl ? { backgroundImage: `url(${page.bannerUrl})` } : bandPatternStyle}
      >
        {page.bannerUrl ? <div className="absolute inset-0 bg-foreground/30" /> : null}
      </section>

      <Tabs defaultValue="offers">
        <div className="border-b border-border bg-card">
          <div className="mx-auto max-w-[1240px] px-5">
            <div className="flex flex-col gap-4 pt-0 pb-5 md:flex-row md:items-end md:justify-between">
              <div className="flex min-w-0 items-end gap-4">
                {isOffice ? (
                  <SquareLogo
                    src={page.imageUrl}
                    name={page.name}
                    className="relative -mt-12 size-24 text-lg md:-mt-14 md:size-28"
                  />
                ) : (
                  <Avatar
                    src={page.imageUrl}
                    name={page.name}
                    className="relative -mt-12 size-24 shrink-0 rounded-full border-4 border-card text-lg md:-mt-14 md:size-28"
                  />
                )}
                <div className="flex min-w-0 flex-col gap-1 pb-0.5">
                  <h1 className="flex items-center gap-2 text-[26px] leading-tight font-bold md:text-[32px]">
                    <span className="min-w-0 truncate">{page.name}</span>
                    {verified ? <VerifiedMark className="size-6" /> : null}
                  </h1>
                  <p className="text-sm text-muted-foreground tabular-nums">{idLine}</p>
                  {page.publishedBy ? (
                    <p className="text-[13px] text-muted-foreground">عبر {page.publishedBy}</p>
                  ) : null}
                </div>
              </div>

              <div className="flex flex-col gap-3 md:items-end">
                {showRating ? (
                  <span className="inline-flex h-7 w-fit items-center bg-success-tint px-2.5 text-[13px] font-semibold text-success-tint-foreground">
                    جودة الصيانة {page.avgRating} ·{" "}
                    {arCount(page.ratingsCount ?? 0, {
                      one: "تقييم واحد",
                      two: "تقييمان",
                      few: "تقييمات",
                      many: "تقييمًا",
                    })}
                  </span>
                ) : null}
                {tel || wa ? (
                  <div className="grid grid-cols-2 gap-2 md:flex">
                    {wa ? (
                      <Button variant="whatsapp" asChild className={tel ? undefined : "col-span-2"}>
                        <a href={wa} target="_blank" rel="noreferrer">
                          <MessageCircle aria-hidden />
                          واتساب
                        </a>
                      </Button>
                    ) : null}
                    {tel ? (
                      <Button variant="outline" asChild className={wa ? undefined : "col-span-2"}>
                        <a href={tel}>
                          <Phone aria-hidden />
                          اتصال
                        </a>
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            <TabsList className="w-full border-b-0">
              <TabsTrigger value="offers">
                العروض <span className="tabular-nums">({arNum(listings.length)})</span>
              </TabsTrigger>
              <TabsTrigger value="about">نبذة تعريفية</TabsTrigger>
            </TabsList>
          </div>
        </div>

        <main className="mx-auto max-w-[1240px] px-5 pt-2 pb-16">
          <TabsContent value="offers" className="mt-6">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search
                  className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  className="ps-9"
                  placeholder="ابحث في عروض هذا المعلن (الحي، النوع…)"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  aria-label="بحث في العروض"
                />
              </div>
              <select
                aria-label="الترتيب"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-11 border border-input bg-card px-3 text-[15px] focus-visible:border-foreground focus-visible:ring-1 focus-visible:ring-foreground focus-visible:outline-none"
              >
                <option value="newest">الأحدث</option>
                <option value="price-asc">الأقل سعرًا</option>
                <option value="price-desc">الأعلى سعرًا</option>
                <option value="area-desc">الأكبر مساحة</option>
              </select>
            </div>

            {shown.length === 0 ? (
              <ArchEmptyState
                title={listings.length === 0 ? "لا توجد عروض فعّالة حاليًا" : "لا توجد عروض مطابقة"}
                hint={
                  listings.length === 0
                    ? `ستظهر هنا عروض ${page.name} فور نشرها.`
                    : "جرّب كلمة أخرى، مثل اسم الحي أو نوع الوحدة."
                }
              >
                {text ? (
                  <Button variant="outline" onClick={() => setText("")}>
                    مسح البحث
                  </Button>
                ) : null}
                <Button asChild variant={text ? "ghost" : "outline"}>
                  <Link to="/">تصفّح كل العروض</Link>
                </Button>
              </ArchEmptyState>
            ) : (
              <>
                <p className="mb-3 text-sm text-muted-foreground">{offersCount(shown.length)}</p>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {shown.map((l) => (
                    <ListingRow key={l.id} listing={l} showAdvertiser={false} />
                  ))}
                </div>
              </>
            )}
          </TabsContent>

          <TabsContent value="about" className="mt-6">
            <div className="max-w-3xl border border-border bg-card p-5 md:p-6">
              {hasAbout ? (
                <div className="flex flex-col gap-5">
                  {page.bio ? (
                    <p className="text-[15px] leading-relaxed whitespace-pre-line">{page.bio}</p>
                  ) : null}
                  {page.propertyTypes || page.areas || page.location || page.licenseNo ? (
                    <dl className="grid gap-4 border-t border-border pt-5 text-[15px] sm:grid-cols-2">
                      {page.propertyTypes ? (
                        <Row label="أنواع العقارات" value={page.propertyTypes} />
                      ) : null}
                      {page.areas ? <Row label="مناطق العمل" value={page.areas} /> : null}
                      {page.location ? (
                        <Row
                          label="الموقع"
                          value={
                            <span className="flex items-start gap-1.5">
                              <MapPin
                                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                                aria-hidden
                              />
                              {page.location}
                            </span>
                          }
                        />
                      ) : null}
                      {page.licenseNo ? (
                        <Row
                          label="رخصة فال"
                          value={
                            <span dir="ltr" className="tabular-nums">
                              {page.licenseNo}
                            </span>
                          }
                        />
                      ) : null}
                    </dl>
                  ) : null}
                </div>
              ) : (
                <p className="text-muted-foreground">لم تتم إضافة نبذة بعد.</p>
              )}
            </div>
          </TabsContent>
        </main>
      </Tabs>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
