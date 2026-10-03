import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, ImageOff, Images } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { mediaUrl } from "@/lib/unit-photos";

/**
 * Listing gallery: one large photo with up to three thumbnails beside it («+N» on the last one),
 * and a full-screen viewer with previous/next buttons and the arrow keys.
 */
export function PhotoGallery({ paths, alt }: { paths: string[]; alt: string }) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const count = paths.length;

  const show = (i: number) => {
    setIndex(i);
    setOpen(true);
  };
  const next = useCallback(() => setIndex((i) => (i + 1) % count), [count]);
  const prev = useCallback(() => setIndex((i) => (i - 1 + count) % count), [count]);

  useEffect(() => {
    if (!open || count < 2) return;
    const onKey = (e: KeyboardEvent) => {
      // The page is right-to-left: the left arrow moves forward.
      if (e.key === "ArrowLeft") next();
      if (e.key === "ArrowRight") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, count, next, prev]);

  if (count === 0) {
    return (
      <div className="grid aspect-[16/8] place-items-center rounded-xl border border-dashed border-border bg-muted text-muted-foreground">
        <span className="flex flex-col items-center gap-2 text-sm">
          <ImageOff className="size-10 opacity-50" aria-hidden />
          لا توجد صور لهذا العرض بعد
        </span>
      </div>
    );
  }

  const side = paths.slice(1, 4);
  const hidden = count - 4;

  return (
    <>
      <div className="grid gap-2 md:grid-cols-[3fr_1fr]">
        <button
          type="button"
          onClick={() => show(0)}
          className="group relative block aspect-[16/10] overflow-hidden rounded-xl bg-muted"
          aria-label="عرض الصور بحجم كبير"
        >
          <img
            src={mediaUrl(paths[0]!)}
            alt={alt}
            className="size-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
          />
          {count > 1 ? (
            <span className="absolute end-3 bottom-3 inline-flex items-center gap-1.5 rounded-md bg-black/65 px-3 py-1.5 text-sm text-white">
              <Images className="size-4" aria-hidden />
              {count} صور
            </span>
          ) : null}
        </button>

        {side.length > 0 ? (
          <div className="grid grid-cols-3 gap-2 md:grid-cols-1 md:grid-rows-3">
            {side.map((p, i) => (
              <button
                key={p}
                type="button"
                onClick={() => show(i + 1)}
                className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-muted md:aspect-auto"
                aria-label={`عرض الصورة ${i + 2}`}
              >
                <img
                  src={mediaUrl(p)}
                  alt={`${alt} — صورة ${i + 2}`}
                  loading="lazy"
                  className="size-full object-cover"
                />
                {i === side.length - 1 && hidden > 0 ? (
                  <span
                    dir="ltr"
                    className="absolute inset-0 grid place-items-center bg-black/55 text-lg font-bold text-white"
                  >
                    +{hidden}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl gap-3 border-0 bg-black/95 p-3 text-white sm:max-w-4xl">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          <DialogDescription className="sr-only">
            صورة {index + 1} من {count}
          </DialogDescription>
          <div className="relative">
            <img
              src={mediaUrl(paths[index]!)}
              alt={`${alt} — صورة ${index + 1}`}
              className="mx-auto max-h-[70vh] w-full rounded-md object-contain"
            />
            {count > 1 ? (
              <>
                <button
                  type="button"
                  onClick={prev}
                  aria-label="الصورة السابقة"
                  className="absolute end-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center bg-white/20 hover:bg-white/35"
                >
                  <ChevronRight className="size-6" />
                </button>
                <button
                  type="button"
                  onClick={next}
                  aria-label="الصورة التالية"
                  className="absolute start-2 top-1/2 grid size-10 -translate-y-1/2 place-items-center bg-white/20 hover:bg-white/35"
                >
                  <ChevronLeft className="size-6" />
                </button>
              </>
            ) : null}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-white/70">
              {index + 1} / {count}
            </span>
            <div className="flex gap-1.5 overflow-x-auto">
              {paths.map((p, i) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`الانتقال إلى الصورة ${i + 1}`}
                  aria-current={i === index}
                  className={`size-12 shrink-0 overflow-hidden rounded border-2 ${
                    i === index ? "border-brass" : "border-transparent opacity-70"
                  }`}
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
