import { Link } from "@tanstack/react-router";
import { BadgeCheck, ChevronLeft, MessageCircle, Phone, Star } from "lucide-react";

import { Avatar } from "@/components/listing-row";
import { bandPatternStyle } from "@/components/site-header";
import { Button } from "@/components/ui/button";
import { phoneHref, whatsappHref } from "@/lib/market";

export type AdvertiserView = {
  kind: "office" | "owner";
  id: string;
  name: string;
  /** Avatar (owner) or logo (office), already a full URL. */
  imageUrl: string | null;
  bannerUrl: string | null;
  /** Second line under the name (e.g. the office that publishes an owner's page). */
  subtitle?: string | null;
  licenseNo?: string | null;
  phone: string | null;
  whatsapp: string | null;
  listingsCount?: number | null;
  /** متوسط تقييم المستأجرين لصيانة هذا المكتب (لا يظهر إلا للمكاتب الموثّقة). */
  avgRating?: number | null;
  ratingsCount?: number | null;
};

/** The advertiser box on a listing page: banner, round picture, contact buttons, link to all offers. */
export function AdvertiserCard({
  advertiser: a,
  inquiry,
  onContactClick,
}: {
  advertiser: AdvertiserView;
  /** Pre-filled WhatsApp message. */
  inquiry?: string;
  /** Fired when the visitor taps the call or WhatsApp button (e.g. for listing analytics). */
  onContactClick?: (kind: "call" | "whatsapp") => void;
}) {
  const tel = phoneHref(a.phone);
  const wa = whatsappHref(a.whatsapp ?? a.phone, inquiry);
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-deed">
      <div
        className="relative h-20 bg-sidebar bg-cover bg-center"
        style={a.bannerUrl ? { backgroundImage: `url(${a.bannerUrl})` } : bandPatternStyle}
      />
      <div className="px-4 pb-4">
        {/* `relative` puts the avatar above the (positioned) banner it overlaps */}
        <div className="relative -mt-9 flex items-end justify-between gap-3">
          <Avatar
            src={a.imageUrl}
            name={a.name}
            className="size-[4.5rem] border-4 border-card bg-card shadow"
          />
        </div>
        <p className="mt-2 font-display text-lg font-bold">{a.name}</p>
        {a.subtitle ? <p className="text-sm text-muted-foreground">{a.subtitle}</p> : null}
        {a.licenseNo ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <BadgeCheck className="size-4 text-brass" aria-hidden />
            ترخيص فال <span dir="ltr">{a.licenseNo}</span>
          </p>
        ) : null}
        {/* 3 تقييمات على الأقل حتى ما تُبنى شارة على انطباع واحد عابر. */}
        {a.avgRating != null && (a.ratingsCount ?? 0) >= 3 ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Star className="size-4 fill-brass text-brass" aria-hidden />
            {a.avgRating} من 5 — {a.ratingsCount} تقييم صيانة
          </p>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-2">
          {tel ? (
            <Button variant="secondary" asChild>
              <a href={tel} onClick={() => onContactClick?.("call")}>
                <Phone className="size-4" aria-hidden />
                اتصال
              </a>
            </Button>
          ) : null}
          {wa ? (
            <Button variant="secondary" asChild className="text-success">
              <a
                href={wa}
                target="_blank"
                rel="noreferrer"
                onClick={() => onContactClick?.("whatsapp")}
              >
                <MessageCircle className="size-4" aria-hidden />
                واتساب
              </a>
            </Button>
          ) : null}
        </div>

        <div className="mt-4 border-t border-border pt-3 text-sm">
          {a.kind === "owner" ? (
            <Link
              to="/owner/$ownerId"
              params={{ ownerId: a.id }}
              className="flex items-center justify-between font-medium text-primary hover:underline"
            >
              عرض جميع العقارات{a.listingsCount != null ? ` (${a.listingsCount})` : ""}
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          ) : (
            <Link
              to="/office/$officeId"
              params={{ officeId: a.id }}
              className="flex items-center justify-between font-medium text-primary hover:underline"
            >
              عرض جميع العقارات{a.listingsCount != null ? ` (${a.listingsCount})` : ""}
              <ChevronLeft className="size-4" aria-hidden />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
