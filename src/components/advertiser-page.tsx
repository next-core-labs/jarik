import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { BadgeCheck, MapPin, MessageCircle, Phone, Search, SearchX, Star } from "lucide-react";

import { Avatar, ListingRow } from "@/components/listing-row";
import { SiteHeader, bandPatternStyle } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

/** Public page of an office or an owner: identity band, bio, and their active offers. */
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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />

      <section
        className="relative bg-sidebar bg-cover bg-center text-sidebar-foreground"
        style={page.bannerUrl ? { backgroundImage: `url(${page.bannerUrl})` } : bandPatternStyle}
      >
        <div className="bg-sidebar/60">
          <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-8 md:py-10">
            <Avatar
              src={page.imageUrl}
              name={page.name}
              className="size-24 rounded-xl border-4 border-card bg-card text-xl shadow-lg md:size-28"
            />
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold md:text-3xl">{page.name}</h1>
              <p className="mt-1 flex items-center gap-2 text-sm text-sidebar-foreground/80">
                <span>{page.kind === "owner" ? "مالك" : "مكتب عقاري"}</span>
                <span aria-hidden className="size-1 bg-current opacity-60" />
                <span>{listings.length.toLocaleString("ar-SA")} عرض فعّال</span>
              </p>
              {page.publishedBy ? (
                <p className="mt-0.5 text-xs text-sidebar-foreground/70">عبر {page.publishedBy}</p>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      <div className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl gap-6 px-4">
          <span className="border-b-2 border-primary py-3 text-sm font-bold text-primary">
            الإعلانات الفعّالة ({listings.length.toLocaleString("ar-SA")})
          </span>
        </div>
      </div>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0">
          <div className="mb-4 flex flex-col gap-2 sm:flex-row">
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
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="newest">الأحدث</option>
              <option value="price-asc">الأقل سعرًا</option>
              <option value="price-desc">الأعلى سعرًا</option>
              <option value="area-desc">الأكبر مساحة</option>
            </select>
          </div>

          {shown.length === 0 ? (
            <div className="grid place-items-center gap-2 rounded-lg border border-dashed border-border bg-card p-12 text-center text-muted-foreground">
              <SearchX className="size-10 opacity-50" aria-hidden />
              <p className="font-medium text-foreground">
                {listings.length === 0 ? "لا توجد عروض فعّالة حاليًا" : "لا توجد عروض مطابقة"}
              </p>
              <Button asChild variant="outline" size="sm">
                <Link to="/">تصفّح كل العروض</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {shown.map((l) => (
                <ListingRow key={l.id} listing={l} showAdvertiser={false} />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4 shadow-deed">
            <h2 className="font-display text-lg font-bold">نبذة تعريفية</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {page.propertyTypes ? (
                <Row label="أنواع العقارات" value={page.propertyTypes} />
              ) : null}
              {page.areas ? <Row label="مناطق العمل" value={page.areas} /> : null}
              {page.location ? (
                <div className="flex items-start gap-1.5 text-muted-foreground">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brass" aria-hidden />
                  {page.location}
                </div>
              ) : null}
              {page.licenseNo ? (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <BadgeCheck className="size-4 text-brass" aria-hidden />
                  ترخيص فال <span dir="ltr">{page.licenseNo}</span>
                </div>
              ) : null}
              {page.avgRating != null && (page.ratingsCount ?? 0) >= 3 ? (
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <Star className="size-4 fill-brass text-brass" aria-hidden />
                  {page.avgRating} من 5 — {page.ratingsCount} تقييم صيانة
                </div>
              ) : null}
              {page.bio ? (
                <p className="pt-1 leading-relaxed whitespace-pre-line text-foreground/90">
                  {page.bio}
                </p>
              ) : null}
              {!page.bio &&
              !page.areas &&
              !page.propertyTypes &&
              !page.location &&
              !page.licenseNo ? (
                <p className="text-muted-foreground">لم تتم إضافة نبذة بعد.</p>
              ) : null}
            </dl>

            {tel || wa ? (
              <div className="mt-4 grid grid-cols-2 gap-2">
                {tel ? (
                  <Button variant="secondary" asChild>
                    <a href={tel}>
                      <Phone className="size-4" aria-hidden />
                      اتصال
                    </a>
                  </Button>
                ) : null}
                {wa ? (
                  <Button variant="secondary" asChild className="text-success">
                    <a href={wa} target="_blank" rel="noreferrer">
                      <MessageCircle className="size-4" aria-hidden />
                      واتساب
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </aside>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
