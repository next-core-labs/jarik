import { toLatinDigits } from "@/lib/saudi-id";

/**
 * لوحة الحجز اليومي: الإعلانات والعملاء. مساعدات عرض بحتة — القاعدة هي من يقرّر ما يظهر في /stays
 * (bookable_units_public) وما يُحتسب على الضيف (quote_booking).
 *
 * الحجز اليومي مسار مستقل عن الإيجار السنوي: إعلانه يُنشأ ويُدار من لوحته، ورخصته رخصة إيواء
 * سياحي لا ترخيص إعلان عقاري، وعملاؤه ضيوف لا مستأجرون بعقود.
 */

/**
 * وحدة للحجز اليومي فقط: لها إعدادات حجز، وليس لها إيجار سنوي ولا سعر بيع. هذه لا مكان لها في
 * شاشات الإيجار (الأملاك والوحدات، العقود، الشواغر) — شاليه يُحجز بالليلة ليس «وحدة شاغرة» تنتظر
 * مستأجرًا. وحدة لها السعران تبقى في المكانين، وهو الصحيح.
 */
export function isDailyOnly(u: {
  annual_rent: number | null;
  sale_price: number | null;
  hasBookingSettings: boolean;
}): boolean {
  return u.hasBookingSettings && !(Number(u.annual_rent) > 0) && !(Number(u.sale_price) > 0);
}

/**
 * PostgREST يعيد العلاقة واحد-لواحد كائنًا أو null، وقد يعيدها مصفوفة حين لا يستنتج أنها كذلك؛
 * هذه تقرأ الشكلين فلا يعتمد إخفاء الوحدات على تفصيلة في الاستنتاج.
 */
export function hasEmbeddedRow(embed: unknown): boolean {
  return Array.isArray(embed) ? embed.length > 0 : embed != null;
}

/**
 * وحدات شاشات الإيجار: كل ما ليس إعلان حجز يومي فقط. الاستعلام يطلب معها
 * `annual_rent, sale_price, unit_booking_settings(unit_id)`.
 */
export function rentalUnits<
  T extends {
    annual_rent: number | null;
    sale_price: number | null;
    unit_booking_settings?: unknown;
  },
>(units: readonly T[] | null | undefined): T[] {
  return (units ?? []).filter(
    (u) =>
      !isDailyOnly({
        annual_rent: u.annual_rent,
        sale_price: u.sale_price,
        hasBookingSettings: hasEmbeddedRow(u.unit_booking_settings),
      }),
  );
}

export type DailyListingState =
  "live" | "paused" | "incomplete" | "unpublished" | "occupied" | "office_pending";

export type DailyListingStatus = { state: DailyListingState; label: string; hint: string | null };

/**
 * لماذا يظهر الإعلان في سوق الحجز اليومي أو لا يظهر. `live` تأتي من bookable_units_public نفسها
 * (مصدر الحقيقة)؛ وما بعدها تفسير للمكتب بترتيب ما يستطيع إصلاحه هو أولًا.
 */
export function dailyListingStatus(l: {
  live: boolean;
  enabled: boolean;
  nightly_rate: number | null;
  tourism_license_no: string | null;
  market_listed: boolean;
  unit_status: string | null;
}): DailyListingStatus {
  if (l.live) return { state: "live", label: "منشور", hint: null };
  if (!l.enabled) {
    return { state: "paused", label: "متوقف", hint: "أوقفتَ استقبال الحجوزات على هذا الإعلان." };
  }
  if (!(Number(l.nightly_rate) > 0)) {
    return { state: "incomplete", label: "ناقص", hint: "أضف سعر الليلة ليظهر الإعلان." };
  }
  if (!l.tourism_license_no?.trim()) {
    return {
      state: "incomplete",
      label: "ناقص",
      hint: "أضف رقم رخصة الإيواء السياحي — لا يُعرض إعلان حجز يومي بدونها.",
    };
  }
  if (l.unit_status && l.unit_status !== "vacant") {
    return {
      state: "occupied",
      label: "غير متاح",
      hint: "الوحدة مؤجَّرة بعقد أو مباعة، فلا تُعرض للحجز اليومي.",
    };
  }
  if (!l.market_listed) {
    return { state: "unpublished", label: "غير منشور", hint: "انشر الإعلان ليظهر للزوار." };
  }
  return {
    state: "office_pending",
    label: "بانتظار التوثيق",
    hint: "الإعلان مكتمل؛ يظهر للزوار بعد توثيق مكتبك وظهوره في دليل المكاتب.",
  };
}

/** مفتاح الضيف: آخر تسعة أرقام من جواله — «05…» و«+9665…» و«٠٥…» شخص واحد. */
export function guestKey(phone: string | null | undefined): string | null {
  const digits = toLatinDigits(phone ?? "").replace(/\D/g, "");
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

export type GuestBooking = {
  guest_name: string | null;
  guest_phone: string | null;
  status: string;
  nights: number;
  total_amount: number;
  from_date: string;
  to_date: string;
  created_at: string;
  unit_label: string;
};

export type Guest = {
  key: string;
  name: string;
  phone: string;
  /** كل طلباته، بما فيها المرفوض والملغى. */
  requests: number;
  /** إقاماته الفعلية: المؤكَّد والمنتهي. */
  stays: number;
  nights: number;
  /** ما دفعه أو سيدفعه عن إقاماته المؤكَّدة والمنتهية — لا يدخل فيه المعلّق ولا الملغى. */
  spent: number;
  pending: number;
  cancelled: number;
  /** أقرب إقامة قادمة (مؤكَّدة أو معلّقة) لم ينتهِ موعدها. */
  nextStay: { from: string; to: string; unit: string } | null;
  /** آخر إقامة مؤكَّدة أو منتهية بدأت. */
  lastStay: { from: string; to: string; unit: string } | null;
  lastActivity: string;
  units: string[];
};

const STAYED = new Set(["confirmed", "completed"]);

/**
 * عملاء الحجز اليومي: كل ضيف مرة واحدة مهما تعدّدت طلباته أو اختلفت كتابة رقمه. الحجب ليس ضيفًا.
 * الترتيب: من له إقامة قادمة أولًا (الأقرب فالأقرب)، ثم الأحدث نشاطًا.
 */
export function summarizeGuests(bookings: GuestBooking[], today: string): Guest[] {
  const byKey = new Map<string, Guest>();
  // الأقدم أولًا، فآخر اسم ورقم يُكتبان هما الأحدث.
  const ordered = [...bookings].sort((a, b) => a.created_at.localeCompare(b.created_at));

  for (const b of ordered) {
    if (b.status === "blocked") continue;
    const key = guestKey(b.guest_phone);
    if (!key) continue;

    let g = byKey.get(key);
    if (!g) {
      g = {
        key,
        name: "",
        phone: "",
        requests: 0,
        stays: 0,
        nights: 0,
        spent: 0,
        pending: 0,
        cancelled: 0,
        nextStay: null,
        lastStay: null,
        lastActivity: b.created_at,
        units: [],
      };
      byKey.set(key, g);
    }

    if (b.guest_name?.trim()) g.name = b.guest_name.trim();
    if (b.guest_phone?.trim()) g.phone = b.guest_phone.trim();
    g.requests += 1;
    g.lastActivity = b.created_at;
    if (b.unit_label && !g.units.includes(b.unit_label)) g.units.push(b.unit_label);

    const stay = { from: b.from_date, to: b.to_date, unit: b.unit_label };
    if (STAYED.has(b.status)) {
      g.stays += 1;
      g.nights += Number(b.nights) || 0;
      g.spent += Number(b.total_amount) || 0;
      if (b.from_date <= today && (!g.lastStay || b.from_date > g.lastStay.from)) g.lastStay = stay;
    }
    if (b.status === "pending") g.pending += 1;
    if (b.status === "cancelled" || b.status === "rejected") g.cancelled += 1;
    if (
      (b.status === "confirmed" || b.status === "pending") &&
      b.to_date > today &&
      b.from_date >= today &&
      (!g.nextStay || b.from_date < g.nextStay.from)
    ) {
      g.nextStay = stay;
    }
  }

  return [...byKey.values()].sort((a, b) => {
    if (a.nextStay && b.nextStay) return a.nextStay.from.localeCompare(b.nextStay.from);
    if (a.nextStay) return -1;
    if (b.nextStay) return 1;
    return b.lastActivity.localeCompare(a.lastActivity);
  });
}

export type BookingStats = {
  pending: number;
  /** إقامات مؤكَّدة لم تنتهِ بعد (الجارية والقادمة). */
  upcoming: number;
  /** ضيوف يدخلون اليوم. */
  arrivingToday: number;
  /** إيراد الإقامات المؤكَّدة والمنتهية التي تبدأ في هذا الشهر. */
  monthRevenue: number;
};

export function bookingStats(
  bookings: Pick<GuestBooking, "status" | "from_date" | "to_date" | "total_amount">[],
  today: string,
): BookingStats {
  const month = today.slice(0, 7);
  const out: BookingStats = { pending: 0, upcoming: 0, arrivingToday: 0, monthRevenue: 0 };
  for (const b of bookings) {
    if (b.status === "pending") out.pending += 1;
    if (b.status === "confirmed" && b.to_date > today) out.upcoming += 1;
    if (b.status === "confirmed" && b.from_date === today) out.arrivingToday += 1;
    if (STAYED.has(b.status) && b.from_date.slice(0, 7) === month) {
      out.monthRevenue += Number(b.total_amount) || 0;
    }
  }
  return out;
}
