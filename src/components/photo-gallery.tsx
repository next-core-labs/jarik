import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { JarakSymbol } from "@/components/jarak-logo";
import { tf } from "@/components/listing-detail/format";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { Locale } from "@/lib/i18n";
import { mediaUrl } from "@/lib/unit-photos";
import { cn } from "@/lib/utils";

/**
 * Listing gallery: a large hero photo with two stacked thumbnails beside it on wide screens, and a
 * full-screen viewer with previous/next buttons, the arrow keys and a sideways swipe. On phones the hero takes the
 * arch top (the brand's "your home" shape); on wide screens it stays square beside its thumbnails.
 */
export function PhotoGallery({
  paths,
  alt,
  locale = "ar",
  badge,
}: {
  paths: string[];
  alt: string;
  locale?: Locale;
  /** Sits on the hero's bottom-start corner (the listing's purpose). */
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const count = paths.length;
  const rtl = locale !== "en";

  const show = (i: number) => {
    setIndex(i);
    setOpen(true);
  };
  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);
  const prev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);

  // A sideways swipe of at least 40px that is more horizontal than vertical. Right-to-left the next
  // photo lies to the left, so dragging the finger rightwards moves forward (like the arrow keys).
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    touchStart.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touchStart.current;
    const t = e.changedTouches[0];
    touchStart.current = null;
    if (!start || !t || count < 2) return;
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx > 0 === rtl) next();
    else prev();
  };

  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      // Right-to-left, the left arrow moves forward; left-to-right, the right arrow does.
      if (e.key === "ArrowLeft") (rtl ? next : prev)();
      if (e.key === "ArrowRight") (rtl ? prev : next)();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, next, prev, rtl]);

  const heroShape =
    "relative h-[280px] overflow-hidden rounded-t-[160px] bg-muted lg:h-[440px] lg:rounded-none";
  const badgeSlot = badge ? (
    <span className="absolute start-3.5 bottom-3.5 flex">{badge}</span>
  ) : null;

  if (count === 0) {
    return (
      <div className={cn(heroShape, "grid place-items-center")}>
        <span className="flex flex-col items-center gap-2 text-[13px] text-muted-foreground">
          <JarakSymbol mono className="size-14 text-foreground opacity-[.22]" />
          {tf(locale, "ld_gallery_empty")}
        </span>
        {badgeSlot}
      </div>
    );
  }

  const thumbs = paths.slice(1, 3);
  const PrevIcon = rtl ? ChevronRight : ChevronLeft;
  const NextIcon = rtl ? ChevronLeft : ChevronRight;

  return (
    <>
      <div
        className={cn(
          "grid gap-2",
          thumbs.length > 0 && "lg:grid-cols-[minmax(0,2.2fr)_minmax(0,1fr)]",
        )}
      >
        <button
          type="button"
          onClick={() => show(0)}
          className={cn(heroShape, "group block w-full cursor-pointer")}
          aria-label={tf(locale, "ld_gallery_open")}
        >
          <img
            src={mediaUrl(paths[0]!)}
            alt={alt}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
          {badgeSlot}
          <span className="absolute end-3.5 bottom-3.5 flex h-[34px] items-center bg-foreground px-3 text-[13px] font-semibold text-background tabular-nums">
            {tf(locale, "ld_gallery_show", { n: count })}
          </span>
        </button>

        {thumbs.length > 0 ? (
          <div className="hidden grid-rows-2 gap-2 lg:grid">
            {thumbs.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => show(i + 1)}
                className={cn(
                  "relative block cursor-pointer overflow-hidden bg-muted",
                  thumbs.length === 1 && "row-span-2",
                )}
                aria-label={tf(locale, "ld_gallery_photo", { n: i + 2 })}
              >
                <img
                  src={mediaUrl(p)}
                  alt={`${alt} — ${tf(locale, "ld_gallery_photo", { n: i + 2 })}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir={rtl ? "rtl" : "ltr"}
          className="max-w-4xl gap-3 border-0 bg-black/95 p-3 text-white sm:max-w-4xl"
        >
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            {tf(locale, "ld_gallery_of", { n: index + 1, total: count })}
          </DialogDescription>
          <div
            className="relative touch-pan-y"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
            onTouchCancel={() => {
              touchStart.current = null;
            }}
          >
            <img
              src={mediaUrl(paths[index]!)}
              alt={`${alt} — ${tf(locale, "ld_gallery_photo", { n: index + 1 })}`}
              className="mx-auto max-h-[70vh] w-full object-contain"
            />
            {count > 1 ? (
              <>
                <button
                  type="button"
                  onClick={prev}
                  aria-label={tf(locale, "ld_gallery_prev")}
                  className="absolute start-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center bg-white/20 hover:bg-white/35"
                >
                  <PrevIcon className="size-6" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label={tf(locale, "ld_gallery_next")}
                  className="absolute end-2 top-1/2 grid size-11 -translate-y-1/2 cursor-pointer place-items-center bg-white/20 hover:bg-white/35"
                >
                  <NextIcon className="size-6" />
                </button>
              </>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/70 tabular-nums">
              {index + 1} / {count}
            </span>
            <div className="flex gap-1.5 overflow-x-auto">
              {paths.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={tf(locale, "ld_gallery_photo", { n: i + 1 })}
                  aria-current={i === index}
                  className={cn(
                    "size-12 shrink-0 cursor-pointer overflow-hidden border-2",
                    i === index ? "border-white" : "border-transparent opacity-70",
                  )}
                >
                  <img src={mediaUrl(p)} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
