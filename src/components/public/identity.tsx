import type { ReactNode } from "react";
import { BadgeCheck } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An office's mark: a white square with a hairline border, holding the uploaded logo or the first
 * letters of the name. Square — the circle is reserved for people's avatars.
 */
export function SquareLogo({
  src,
  name,
  className,
}: {
  src: string | null | undefined;
  name: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid shrink-0 place-items-center overflow-hidden border border-border bg-card text-sm font-bold text-foreground",
        className,
      )}
    >
      {src ? (
        <img
          src={src}
          alt={`شعار ${name}`}
          loading="lazy"
          className="size-full object-contain p-1.5"
        />
      ) : (
        <span aria-hidden>{name.trim().slice(0, 2)}</span>
      )}
    </span>
  );
}

/** The verified mark — one of the few places brand red is allowed. */
export function VerifiedMark({ className }: { className?: string }) {
  return (
    <BadgeCheck
      role="img"
      aria-label="مكتب موثّق"
      className={cn("size-[18px] shrink-0 text-primary", className)}
    />
  );
}

/** Empty state of the public pages: two small outlined arches (the "homes"), a title, a hint. */
export function ArchEmptyState({
  title,
  hint,
  children,
  className,
}: {
  title: string;
  hint?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 border border-border bg-card px-6 py-14 text-center",
        className,
      )}
    >
      <span aria-hidden className="flex items-end gap-1.5">
        <span className="h-[50px] w-8 rounded-arch border-2 border-input" />
        <span className="h-9 w-8 rounded-arch border-2 border-input" />
      </span>
      <p className="text-[17px] font-semibold">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-muted-foreground">{hint}</p> : null}
      {children ? <div className="mt-1 flex flex-wrap justify-center gap-2">{children}</div> : null}
    </div>
  );
}
