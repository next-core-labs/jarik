import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * حجز وحدة بالليلة. يُدرَج من الخادم بصلاحية الخدمة (الجدول يحمل اسم الضيف ورقمه)، والسعر
 * والإتاحة يُعاد احتسابهما في القاعدة — فلا يُثق بما يرسله المتصفح، وقيد EXCLUDE هو من يرفض
 * التزاحم عند التسابق لا فحصٌ سابق له.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** أقصى حجوزات معلّقة لنفس الرقم عند نفس المكتب خلال ساعة — نفس نمط unit_requests. */
const MAX_BOOKINGS_PER_PHONE_PER_HOUR = 5;

/** أبعد تاريخ يُقبل الحجز إليه: سنة من اليوم (تواريخ أبعد غالبًا خطأ إدخال). */
const MAX_DAYS_AHEAD = 365;

/**
 * حساب الزائر إن كان داخلًا. الحجز متاح بلا حساب، فلا نشترط جلسة (لا requireSupabaseAuth) — لكن
 * حين توجد نتحقق من رمزها ونربط الحجز بصاحبه ليظهر في «حجوزاتي». رمز غير صالح = زائر بلا حساب.
 */
async function optionalUserId(): Promise<string | null> {
  try {
    const { getRequest } = await import("@tanstack/react-start/server");
    const header = getRequest()?.headers.get("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (token.split(".").length !== 3) return null;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.auth.getClaims(token);
    if (error || !data?.claims?.sub) return null;
    return data.claims.sub;
  } catch {
    return null;
  }
}

/** سعر وإتاحة مدى من التواريخ — تُستدعى كلما غيّر الزائر التواريخ. القاعدة تحتسب، لا المتصفح. */
export const quoteBooking = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        unitId: z.guid(),
        from: z.string().regex(ISO_DATE),
        to: z.string().regex(ISO_DATE),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("quote_booking", {
      _unit_id: data.unitId,
      _from: data.from,
      _to: data.to,
    });
    if (error) throw new Error("تعذّر حساب السعر — حاول مرة أخرى");
    const q = rows?.[0];
    if (!q) throw new Error("هذه الوحدة غير متاحة للحجز اليومي");
    return {
      available: Boolean(q.available),
      reason: q.reason ?? null,
      nights: Number(q.nights ?? 0),
      weekdayNights: Number(q.weekday_nights ?? 0),
      weekendNights: Number(q.weekend_nights ?? 0),
      nightlyRate: q.nightly_rate == null ? null : Number(q.nightly_rate),
      weekendRate: q.weekend_rate == null ? null : Number(q.weekend_rate),
      total: Number(q.total ?? 0),
      minNights: Number(q.min_nights ?? 1),
      maxGuests: q.max_guests == null ? null : Number(q.max_guests),
      checkinTime: q.checkin_time ?? null,
      checkoutTime: q.checkout_time ?? null,
      freeCancelDays: Number(q.free_cancel_days ?? 0),
    };
  });

export const submitBooking = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        unitId: z.guid(),
        from: z.string().regex(ISO_DATE),
        to: z.string().regex(ISO_DATE),
        fullName: z.string().trim().min(2).max(120),
        phone: z
          .string()
          .trim()
          .regex(/^[0-9+\s-]{9,15}$/, "رقم جوال غير صحيح"),
        guests: z.number().int().min(1).max(500).optional(),
        notes: z.string().trim().max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");

    // مدى معقول: الماضي ترفضه القاعدة، والبعيد جدًا نرفضه هنا قبل إشغال القاعدة به.
    const days = Math.round((Date.parse(`${data.from}T00:00:00`) - Date.now()) / 86_400_000);
    if (days > MAX_DAYS_AHEAD) throw new Error("لا نستقبل حجوزات أبعد من سنة من اليوم");

    const { data: unit, error: unitError } = await supabaseAdmin
      .from("bookable_units_public")
      .select("id, office_id, unit_type, district, city")
      .eq("id", data.unitId)
      .maybeSingle();
    if (unitError) throw new Error("تعذّر إتمام الحجز — حاول مرة أخرى");
    if (!unit?.id || !unit.office_id) {
      throw new Error("هذه الوحدة لم تعد متاحة للحجز — تصفّح الوحدات الأخرى");
    }

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("bookings")
      .select("id", { count: "exact", head: true })
      .eq("guest_phone", data.phone)
      .eq("org_id", unit.office_id)
      .gte("created_at", since);
    if ((recent ?? 0) >= MAX_BOOKINGS_PER_PHONE_PER_HOUR) {
      throw new Error("وصلتنا طلباتك خلال الساعة الماضية — سنتواصل معك قريبًا");
    }

    // القاعدة تعيد احتساب السعر وتفحص الإتاحة وترفض التزاحم؛ رسائلها مكتوبة للضيف فتُعرض كما هي.
    const { data: bookingId, error } = await supabaseAdmin.rpc("create_booking_request", {
      _unit_id: data.unitId,
      _from: data.from,
      _to: data.to,
      _guest_name: data.fullName,
      _guest_phone: data.phone,
      ...(data.guests != null ? { _guests: data.guests } : {}),
      ...(data.notes ? { _notes: data.notes } : {}),
    });
    if (error) throw new Error(error.message || "تعذّر إتمام الحجز");

    // الحجز قائم؛ ربطه بالحساب إضافة فوقه، ففشلها يُسجَّل ولا يُفشل الحجز.
    const guestUserId = await optionalUserId();
    if (guestUserId && bookingId) {
      const { error: linkError } = await supabaseAdmin
        .from("bookings")
        .update({ guest_user_id: guestUserId })
        .eq("id", bookingId);
      if (linkError) console.error("[submitBooking] could not link the guest:", linkError.message);
    }

    const place = [unit.unit_type, unit.district ? `حي ${unit.district}` : null, unit.city]
      .filter(Boolean)
      .join(" · ");
    await notifyStaff(supabaseAdmin, unit.office_id, {
      title: "طلب حجز يومي جديد",
      body: `${data.fullName} — ${data.phone} · ${place} · من ${data.from} إلى ${data.to}`,
      kind: "deal",
      related_table: "bookings",
      related_id: bookingId ?? unit.id,
    });

    return { ok: true as const, bookingId, linked: Boolean(guestUserId) };
  });
