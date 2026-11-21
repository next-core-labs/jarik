import { toLatinDigits } from "@/lib/saudi-id";

/** A typed IBAN as stored: Latin digits, upper case, no spaces or dashes. */
export function normalizeIban(value: string): string {
  return toLatinDigits(value)
    .replace(/[\s\-‏‎]/g, "")
    .toUpperCase();
}

/** ISO 13616 check: move the first four characters to the end, letters become 10–35, mod 97 = 1. */
function passesMod97(iban: string): boolean {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const n = ch >= "A" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of n) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

/** Why a Saudi IBAN is not acceptable, or null when it is (an empty value is the caller's call). */
export function saudiIbanError(value: string): string | null {
  const iban = normalizeIban(value);
  if (!iban.startsWith("SA")) return "الآيبان السعودي يبدأ بـSA";
  if (!/^SA\d{22}$/.test(iban)) return "الآيبان السعودي 24 خانة: SA ثم 22 رقمًا";
  if (!passesMod97(iban)) return "رقم الآيبان غير صحيح — راجعه من تطبيق البنك";
  return null;
}

/** In groups of four, the way banks print it: SA83 8000 0869 … */
export function formatIban(value: string): string {
  return normalizeIban(value).replace(/(.{4})(?=.)/g, "$1 ");
}
