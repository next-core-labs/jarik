import type { TablesInsert } from "@/integrations/supabase/types";
import { parseAmount } from "@/lib/public-form";

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
 * قراءة الأرقام هنا هي نفسها قراءة بقية نافذة الوحدة (parseAmount): تقبل الأرقام الهندية (١٥٠٠)
 * وفواصل الآلاف (1,500 · ١٬٥٠٠) وترفض ما ليس رقمًا — ولا «تنظّف» المُدخَل، فحذف المحارف غير
 * الرقمية يحوّل «-5» إلى 5 بصمت: المكتب يرى سالبًا في الحقل ويُحفظ موجب.
 *
 * وكان هنا قارئ خاص بتعبير \d فقط — أي لاتيني بحت. فسعر ليلة يُكتب بلوحة مفاتيح عربية كان
 * يُقرأ null ويُحفظ فراغًا، فتختفي الوحدة من /stays بلا رسالة واحدة. ولهذا نفرّق أدناه بين
 * «فارغ» و«ليس رقمًا»: الأول نقص، والثاني خطأ يجب أن يُقال للمكتب لا أن يُمحى.
 */
type NumRead = { value: number | null; invalid: boolean };

const readMoney = (v: string): NumRead => {
  const n = parseAmount(v);
  if (n === undefined) return { value: null, invalid: false };
  if (n === null || n <= 0) return { value: null, invalid: true };
  return { value: n, invalid: false };
};

const readCount = (v: string): NumRead => {
  const n = parseAmount(v);
  if (n === undefined) return { value: null, invalid: false };
  if (n === null || n <= 0 || !Number.isInteger(n)) return { value: null, invalid: true };
  return { value: n, invalid: false };
};

/** عدد صحيح ≥ 0 (الإلغاء المجاني): الفارغ والخطأ كلاهما صفر، فلا يمنع الحفظ. */
const readDays = (v: string): number => {
  const n = parseAmount(v);
  return n === undefined || n === null || n < 0 ? 0 : Math.floor(n);
};

const money = (v: string): number | null => readMoney(v).value;
const count = (v: string): number | null => readCount(v).value;

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
    free_cancel_days: Math.min(60, readDays(f.free_cancel_days)),
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
 * ما ينقص — أو ما كُتب خطأً — قبل أن تظهر الوحدة في سوق الحجز اليومي. تُقال للمكتب قبل الحفظ،
 * وتمنعه (formError في نافذة الوحدة): حفظ «الحجز اليومي» بسعر أو رخصة ناقصة ينتج وحدة مفعَّلة
 * لا تظهر في /stays ولا تقول لأحد لماذا — وهو ما حدث فعلًا. فارغة = جاهزة.
 * تُستدعى فقط عند التفعيل.
 */
export function bookingBlockers(f: BookingForm): string[] {
  const out: string[] = [];

  const rate = readMoney(f.nightly_rate);
  if (rate.invalid) out.push("سعر الليلة ليس رقمًا موجبًا — اكتبه بالأرقام، مثال: 1500.");
  else if (rate.value === null) out.push("أضف سعر الليلة في أيام الأسبوع.");

  const weekend = readMoney(f.weekend_rate);
  if (weekend.invalid) {
    out.push("سعر ليلة نهاية الأسبوع ليس رقمًا موجبًا — أو اتركه فارغًا ليساوي سعر الأسبوع.");
  }

  if (!f.tourism_license_no.trim()) {
    out.push("أضف رقم رخصة الإيواء السياحي — النظام يُلزم بها للتأجير اليومي.");
  }

  const guests = readCount(f.max_guests);
  if (guests.invalid) out.push("أقصى عدد ضيوف رقم صحيح — أو اتركه فارغًا.");

  const nights = readCount(f.min_nights);
  if (nights.invalid) out.push("أقل مدة حجز رقم صحيح من 1 إلى 90.");

  if (f.checkin_time && f.checkout_time && f.checkin_time === f.checkout_time) {
    out.push("وقت الدخول ووقت الخروج متطابقان.");
  }
  return out;
}
