import { toLatinDigits } from "@/lib/saudi-id";

/**
 * A Saudi mobile number as typed on the public request forms, in the local form 05XXXXXXXX, or null
 * when it isn't one. Accepts Arabic-Indic digits, spaces, dashes and brackets, and the 966 / +966 /
 * 00966 prefixes; letters anywhere make it invalid.
 */
export function parseSaudiMobile(value: string): string | null {
  const s = toLatinDigits(value).trim();
  if (!/^\+?[\d\s\-()]+$/.test(s)) return null;
  let d = s.replace(/\D/g, "");
  if (d.startsWith("00966")) d = d.slice(5);
  else if (d.startsWith("966")) d = d.slice(3);
  else if (d.startsWith("0")) d = d.slice(1);
  return /^5\d{8}$/.test(d) ? `0${d}` : null;
}

/**
 * An optional amount in riyals: undefined when left empty, null when it isn't a number. Accepts
 * Arabic-Indic digits and thousands separators (1,500 · ١٬٥٠٠).
 */
export function parseAmount(value: string): number | null | undefined {
  const s = toLatinDigits(value)
    .replace(/[\s,٬]/g, "")
    .replace("٫", ".");
  if (!s) return undefined;
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}
