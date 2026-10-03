/** الهوية الوطنية تبدأ بـ1 والإقامة تبدأ بـ2، وكلتاهما 10 أرقام. */
export type IdType = "national" | "iqama";

export type AccountType = "office" | "owner" | "tenant";

export const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  office: "مكتب عقاري",
  owner: "مالك",
  tenant: "مستأجر",
};

/** Arabic-Indic digits are what a Saudi keyboard produces, so they count as digits here. */
export function toLatinDigits(value: string): string {
  return value.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function digitsOnly(value: string): string {
  return toLatinDigits(value).replace(/\D/g, "");
}

/** The kind of document a number belongs to, or null when it is not a valid one. */
export function idTypeOf(value: string): IdType | null {
  const d = digitsOnly(value);
  if (d.length !== 10) return null;
  if (d.startsWith("1")) return "national";
  if (d.startsWith("2")) return "iqama";
  return null;
}

/**
 * The Arabic problem with the number, or null when it is acceptable.
 * An office is a Saudi business: it is identified by a national ID, never by an iqama.
 */
export function validateSaudiId(value: string, account: AccountType): string | null {
  const d = digitsOnly(value);
  if (d.length === 0) return "أدخل رقم الهوية";
  if (d.length !== 10) return "الرقم يجب أن يكون 10 أرقام";
  const type = idTypeOf(d);
  if (!type) return "الرقم يجب أن يبدأ بـ1 (هوية وطنية) أو 2 (إقامة)";
  if (account === "office" && type === "iqama") {
    return "حساب المكتب يحتاج هوية وطنية تبدأ بـ1";
  }
  return null;
}

/** «فال» licence numbers are digits; the register is not public, so only the shape is checked. */
export function validateFalLicense(value: string): string | null {
  const d = digitsOnly(value);
  if (d.length === 0) return "أدخل رقم رخصة فال";
  if (d.length < 6 || d.length > 12) return "رقم رخصة فال غير صحيح";
  return null;
}
