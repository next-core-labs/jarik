import { translate, type Locale, type TranslationKey } from "@/lib/i18n";

/** A translated string with its `{name}` placeholders filled in. */
export function tf(
  locale: Locale,
  key: TranslationKey,
  vars: Record<string, string | number> = {},
): string {
  return translate(locale, key).replace(/\{(\w+)\}/g, (m, name: string) =>
    name in vars ? String(vars[name]) : m,
  );
}

/** Western digits (0–9) in both languages — the design system's rule for prices and figures, and
 *  what the marketplace cards beside the map show. `locale` is kept for callers' symmetry. */
export function formatNumber(n: number, _locale: Locale, opts: Intl.NumberFormatOptions = {}) {
  return n.toLocaleString("en-US", {
    maximumFractionDigits: 0,
    ...opts,
  });
}

/** «320 م» under a kilometre (to the nearest 10 m), «1.2 كم» from there on. */
export function formatDistance(meters: number, locale: Locale): string {
  const rounded = Math.round(meters / 10) * 10;
  if (rounded < 1000) return `${formatNumber(rounded, locale)} ${translate(locale, "unit_m")}`;
  const km = formatNumber(meters / 1000, locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `${km} ${translate(locale, "unit_km")}`;
}

/** Walking at 5 km/h, never less than a minute. */
export function walkMinutes(km: number): number {
  return Math.max(1, Math.round((km / 5) * 60));
}

/** Driving at 30 km/h in town, plus two minutes to get going and park. */
export function driveMinutes(km: number): number {
  return Math.round((km / 30) * 60 + 2);
}

/** «x د مشياً» within 1.5 km, «x د بالسيارة» beyond it. */
export function travelTime(km: number, locale: Locale): string {
  return km <= 1.5
    ? tf(locale, "ld_nearby_walk_min", { n: formatNumber(walkMinutes(km), locale) })
    : tf(locale, "ld_nearby_drive_min", { n: formatNumber(driveMinutes(km), locale) });
}
