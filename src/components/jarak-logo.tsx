import { cn } from "@/lib/utils";

/* Jarak identity, concept 1b "Two neighbours": the taller ink home is the office, its ground runs
   under the red home next door — the tenant's. Ink parts use currentColor, so the same component
   is the full-colour mark on plaster and the reversed mark on the ink sidebar. The red home is the
   one red element; pass mono to drop it (e.g. on a red background, where the full-colour mark is
   never placed). */

const INK_HOME = "M8 94V38A20 20 0 0 1 48 38V82H94V94Z M20 94V64A8 8 0 0 1 36 64V94Z";
const RED_HOME = "M54 76V52A18 18 0 0 1 90 52V76Z M64 76V62A8 8 0 0 1 80 62V76Z";

export function JarakSymbol({ className, mono = false }: { className?: string; mono?: boolean }) {
  return (
    <svg viewBox="0 0 100 100" className={cn("size-10 shrink-0", className)} aria-hidden="true">
      <path fill="currentColor" fillRule="evenodd" d={INK_HOME} />
      <path fill={mono ? "currentColor" : "#EC3013"} fillRule="evenodd" d={RED_HOME} />
    </svg>
  );
}

/** Custom monoline "جارك" — drawn on the same 14-unit stroke, arch and miter as the symbol. */
export function JarakWordmark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 10 244 128" className={cn("h-7 w-auto shrink-0", className)} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeLinejoin="miter" strokeMiterlimit={10}>
        <path strokeWidth={14} d="M10 76V100H60V28" />
        <path strokeWidth={9} d="M28 48H41L30 62H43" />
        <path strokeWidth={14} d="M104 72V104A24 24 0 0 1 80 128" />
        <path strokeWidth={14} d="M138 20V100H190L226 52H164" />
      </g>
      <rect x={170} y={70} width={15} height={15} fill="currentColor" />
    </svg>
  );
}

/** Horizontal lockup. In RTL the symbol sits on the right (reading start), wordmark after it. */
export function JarakLogo({
  className,
  size = "md",
  label = "جارك",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const symbol = { sm: "size-8", md: "size-10", lg: "size-12" }[size];
  const word = { sm: "h-6", md: "h-7", lg: "h-9" }[size];
  return (
    <span
      role="img"
      aria-label={label}
      className={cn("inline-flex items-center gap-2.5", className)}
    >
      <JarakSymbol className={symbol} />
      <JarakWordmark className={word} />
    </span>
  );
}
