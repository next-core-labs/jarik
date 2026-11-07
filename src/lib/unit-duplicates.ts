/**
 * How deeds and unit numbers are compared for duplicates — the same rules as the database
 * (private.deed_norm / private.unit_number_norm in 20261107140000_owner_logic_unit_rights.sql).
 */

/** Arabic-Indic (٠-٩) and Persian (۰-۹) digits as Latin ones. */
function latinDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
}

/** A deed number as its digits only ("٣١٠ ١١٧-٠١" → "31011701"); "" when it has none. */
export function normalizeDeed(value: string | null | undefined): string {
  return latinDigits(value ?? "").replace(/[^0-9]/g, "");
}

/** A deed is written in digits, optionally grouped by spaces, "/" or "-". */
export function deedFormatError(value: string): string | null {
  const v = value.trim();
  if (!v) return null;
  return /^[0-9٠-٩۰-۹\s/-]+$/.test(v) && normalizeDeed(v) ? null : "رقم الصك أرقام فقط";
}

/** A unit number as compared within its property: "١٠١ " and "101" are the same unit. */
export function normalizeUnitNumber(value: string | null | undefined): string {
  return latinDigits(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}
