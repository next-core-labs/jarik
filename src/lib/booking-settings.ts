import type { TablesInsert } from "@/integrations/supabase/types";

/**
 * نموذج إعدادات الحجز اليومي في نافذة الوحدة. الحقول نصوص (كما يكتبها المستخدم) وتُحوَّل عند
 * الحفظ، بنفس نمط بقية نافذة الوحدة. القاعدة هي من يفرض القواعد الحقيقية: سعر ليلة > 0 لتظهر
 * الوحدة، ورخصة إيواء سياحي لتُعرض للعموم (bookable_units_public).
 */

export type BookingSettingsRow = {
  unit_id: string;
  enabled: boolean;
  nightly_rate: number | null;
  weekend_rate: number | null;
  min_nights: number;
  max_guests: number | null;
  checkin_time: string;
  checkout_time: string;
  tourism_license_no: string | null;
  free_cancel_days: number;
  house_rules: string | null;
};

export type BookingForm = {
  enabled: boolean;
  nightly_rate: string;
  weekend_rate: string;
  min_nights: string;
  max_guests: string;
  checkin_time: string;
  checkout_time: string;
  tourism_license_no: string;
  free_cancel_days: string;
  house_rules: string;
};

export const emptyBooking: BookingForm = {
  enabled: false,
  nightly_rate: "",
  weekend_rate: "",
  min_nights: "1",
  max_guests: "",
  checkin_time: "16:00",
  checkout_time: "12:00",
  tourism_license_no: "",
  free_cancel_days: "3",
  house_rules: "",
};

/** الوقت يأتي من Postgres كـ`16:00:00`؛ حقل <input type="time"> يريد `16:00`. */
const hhmm = (t: string | null | undefined, fallback: string) =>
  t && /^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : fallback;

export function bookingFromRow(row: BookingSettingsRow | null): BookingForm {
  if (!row) return emptyBooking;
  return {
    enabled: Boolean(row.enabled),
    nightly_rate: row.nightly_rate == null ? "" : String(row.nightly_rate),
    weekend_rate: row.weekend_rate == null ? "" : String(row.weekend_rate),
    min_nights: String(row.min_nights ?? 1),
    max_guests: row.max_guests == null ? "" : String(row.max_guests),
    checkin_time: hhmm(row.checkin_time, "16:00"),
    checkout_time: hhmm(row.checkout_time, "12:00"),
    tourism_license_no: row.tourism_license_no ?? "",
    free_cancel_days: String(row.free_cancel_days ?? 0),
    house_rules: row.house_rules ?? "",
  };
}

/**
 * قراءة صارمة لا «تنظيف». حذف المحارف غير الرقمية يحوّل «-5» إلى 5 بصمت: المكتب يرى سالبًا في
 * الحقل ويُحفظ موجب — وهذا أسوأ من رفض المُدخَل. فما لم يكن رقمًا صحيحًا يُعَد غير محدَّد (null)،
 * وشروط الظهور (bookingBlockers) تقول للمكتب إن السعر ناقص.
 */
const money = (v: string): number | null => {
  const t = v.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
};
const count = (v: string): number | null => {
  const t = v.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n > 0 ? n : null;
};

export function bookingToRow(
  unitId: string,
  f: BookingForm,
): TablesInsert<"unit_booking_settings"> {
  return {
    unit_id: unitId,
    enabled: f.enabled,
    nightly_rate: money(f.nightly_rate),
    weekend_rate: money(f.weekend_rate),
    min_nights: Math.min(90, Math.max(1, count(f.min_nights) ?? 1)),
    max_guests: count(f.max_guests),
    checkin_time: f.checkin_time || "16:00",
    checkout_time: f.checkout_time || "12:00",
    tourism_license_no: f.tourism_license_no.trim() || null,
    free_cancel_days: Math.min(60, Math.max(0, Number(f.free_cancel_days) || 0)),
    house_rules: f.house_rules.trim() || null,
  };
}

/** لا نكتب الصف إن لم يتغيّر شيء — فحفظ وحدة لأجل حقل آخر لا يلمس إعدادات الحجز. */
export function bookingDirty(f: BookingForm, row: BookingSettingsRow | null): boolean {
  const before = JSON.stringify(bookingToRow("x", bookingFromRow(row)));
  const after = JSON.stringify(bookingToRow("x", f));
  return before !== after;
}

/**
 * ما ينقص قبل أن تظهر الوحدة في سوق الحجز اليومي — تُقال للمكتب قبل الحفظ، لا كخطأ بعده.
 * فارغة = جاهزة. تُستدعى فقط عند التفعيل.
 */
export function bookingBlockers(f: BookingForm): string[] {
  const out: string[] = [];
  if (money(f.nightly_rate) === null) out.push("أضف سعر الليلة في أيام الأسبوع.");
  if (!f.tourism_license_no.trim()) {
    out.push("أضف رقم رخصة الإيواء السياحي — النظام يُلزم بها للتأجير اليومي.");
  }
  if (f.checkin_time && f.checkout_time && f.checkin_time === f.checkout_time) {
    out.push("وقت الدخول ووقت الخروج متطابقان.");
  }
  return out;
}
