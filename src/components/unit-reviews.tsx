import { Star } from "lucide-react";

import { Stars } from "@/components/booking-review";
import { tf } from "@/components/listing-detail/format";
import { publicDate } from "@/lib/format";
import { ratingLabel } from "@/lib/bookings";
import { translate, type Locale } from "@/lib/i18n";

/** تقييم ضيف لوحدة كما يعرضه unit_reviews_public: الاسم الأول فقط، ولا شيء عن الحجز نفسه. */
export type UnitReview = {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string | null;
  guestFirstName: string | null;
};

/** تقييمات الضيوف على صفحة الوحدة — لا يُعرض القسم أصلًا لوحدة بلا تقييم. */
export function UnitReviews({ reviews, locale }: { reviews: UnitReview[]; locale: Locale }) {
  if (reviews.length === 0) return null;
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-bold">{translate(locale, "bk_reviews_title")}</h2>
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Star className="size-4 fill-brass text-brass" aria-hidden />
          <span className="font-bold text-foreground tabular-nums">{ratingLabel(avg, locale)}</span>
          <span>· {tf(locale, "bk_reviews_count", { n: reviews.length })}</span>
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {reviews.map((r) => (
          <li key={r.id} className="flex flex-col gap-1.5 border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold" dir="auto">
                {r.guestFirstName || translate(locale, "bk_reviews_guest")}
              </span>
              <Stars value={r.rating} />
            </div>
            {r.comment ? (
              <p className="text-sm leading-relaxed whitespace-pre-line" dir="auto">
                {r.comment}
              </p>
            ) : null}
            {r.createdAt ? (
              <span className="text-xs text-muted-foreground">
                {publicDate(r.createdAt, locale)}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
