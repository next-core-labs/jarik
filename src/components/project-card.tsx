import { Link } from "@tanstack/react-router";
import { Building2, CalendarClock, ImageOff, MapPin } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { langSearch, translate, type Locale } from "@/lib/i18n";
import { publicNum, publicSar } from "@/lib/format";
import { deliveryLabel, statusLabel, type Project } from "@/lib/projects";
import { mediaUrl } from "@/lib/unit-photos";
import { cn } from "@/lib/utils";

/** شريط نسبة الإنجاز — الرقم الذي يهمّ المشتري على الخارطة أكثر من أي وصف. */
export function CompletionBar({
  pct,
  label,
  className,
}: {
  pct: number;
  label: string;
  className?: string;
}) {
  const safe = Math.max(0, Math.min(100, Math.round(pct)));
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-bold tabular-nums">{safe}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden bg-muted"
        role="progressbar"
        aria-valuenow={safe}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full bg-brass" style={{ width: `${safe}%` }} />
      </div>
    </div>
  );
}

/** بطاقة مشروع في قائمة المشاريع: صورة، المرحلة، «يبدأ من»، الموقع، الإنجاز والتسليم. */
export function ProjectCard({ project: p, locale = "ar" }: { project: Project; locale?: Locale }) {
  const t = (key: Parameters<typeof translate>[1]) => translate(locale, key);
  const search = langSearch(locale);
  const cover = p.coverPath ? mediaUrl(p.coverPath) : null;
  const delivery = deliveryLabel(p, locale);
  const location = [p.district ? (locale === "en" ? p.district : `حي ${p.district}`) : null, p.city]
    .filter(Boolean)
    .join(" · ");

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-border bg-card shadow-deed transition-shadow hover:shadow-e1">
      <Link
        to="/project/$projectId"
        params={{ projectId: p.id }}
        search={search}
        className="relative mx-2.5 mt-2.5 block aspect-[16/9] overflow-hidden rounded-arch bg-muted"
        aria-label={p.name}
      >
        {cover ? (
          <img
            src={cover}
            alt={p.name}
            loading="lazy"
            className="size-full object-cover grayscale contrast-[1.08]"
          />
        ) : (
          <span className="grid size-full place-content-center justify-items-center gap-1 px-3 text-center text-muted-foreground">
            <ImageOff className="size-9 opacity-50" aria-hidden />
          </span>
        )}
        <span className="absolute start-2.5 bottom-2.5 flex flex-wrap gap-1">
          {p.featured ? (
            <Badge className="bg-foreground text-background hover:bg-foreground">
              {t("badge_featured")}
            </Badge>
          ) : null}
          <Badge className="bg-brass text-brass-foreground hover:bg-brass">
            {statusLabel(p.status, locale)}
          </Badge>
        </span>
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3.5">
        <div className="flex flex-col gap-0.5">
          <Link
            to="/project/$projectId"
            params={{ projectId: p.id }}
            search={search}
            className="truncate text-[15px] font-bold underline-offset-4 hover:underline"
          >
            {p.name}
          </Link>
          {p.developerName ? (
            <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
              <Building2 className="size-3.5 shrink-0 text-brass" aria-hidden />
              <span className="truncate">{p.developerName}</span>
            </p>
          ) : null}
          {location ? (
            <p className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
              <MapPin className="size-3.5 shrink-0 text-brass" aria-hidden />
              <span className="truncate">{location}</span>
            </p>
          ) : null}
        </div>

        {p.priceFrom > 0 ? (
          <p className="text-[13px] text-muted-foreground">
            {t("pj_price_from")}{" "}
            <span className="text-[17px] font-bold text-foreground tabular-nums">
              {publicSar(p.priceFrom, locale)}
            </span>
          </p>
        ) : null}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          {p.status !== "ready" ? (
            <CompletionBar pct={p.completionPct} label={t("pj_completion")} />
          ) : null}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {delivery ? (
              <span className="flex items-center gap-1">
                <CalendarClock className="size-3.5" aria-hidden />
                {delivery}
              </span>
            ) : null}
            {p.modelsCount > 0 ? (
              <span className="tabular-nums">
                {publicNum(p.modelsCount)} {t("pj_models")}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </article>
  );
}
