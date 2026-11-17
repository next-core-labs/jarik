import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/** أقصى عدد طلبات من الرقم نفسه خلال الساعة (الصفحة عامة بدون تسجيل). */
const MAX_MARKET_REQUESTS_PER_PHONE_PER_HOUR = 3;

/**
 * نشر طلب في سوق الطلبات العام (بدون تسجيل دخول): يظهر لكل المكاتب والملاك، بخلاف طلب الوحدة على
 * صفحة عرض معيّن (submitUnitRequest) الذي يصل مكتبًا واحدًا فقط. الاسم ورقم الجوال لا يُعرضان
 * لغير الموظفين المسجّلين أبدًا — القراءة العامة عبر market_requests_public تستثنيهما بالكامل.
 */
export const submitMarketRequest = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        fullName: z.string().min(2).max(120),
        phone: z.string().regex(/^[0-9+\s-]{9,15}$/, "رقم جوال غير صحيح"),
        purpose: z.enum(["rent", "sale"]).default("rent"),
        unitType: z.string().max(40).optional(),
        city: z.string().max(80).optional(),
        district: z.string().max(80).optional(),
        budgetMin: z.number().min(0).max(50_000_000).optional(),
        budgetMax: z.number().min(0).max(50_000_000).optional(),
        notes: z.string().max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Fast-path check for a friendly message on the common case; the database trigger
    // (enforce_rate_limit, advisory-lock-serialized) is the actual race-free enforcement — see
    // the migration for why two separate round-trips here can never be atomic on their own.
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("market_requests")
      .select("id", { count: "exact", head: true })
      .eq("phone", data.phone)
      .gte("created_at", since);
    if ((recent ?? 0) >= MAX_MARKET_REQUESTS_PER_PHONE_PER_HOUR) {
      throw new Error("نشرت طلبات كافية خلال الساعة الماضية — حاول لاحقًا");
    }

    const { data: row, error } = await supabaseAdmin
      .from("market_requests")
      .insert({
        full_name: data.fullName,
        phone: data.phone,
        purpose: data.purpose,
        unit_type: data.unitType ?? null,
        city: data.city ?? null,
        district: data.district ?? null,
        budget_min: data.budgetMin ?? null,
        budget_max: data.budgetMax ?? null,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error || !row) {
      if (error?.message?.includes("MARKET_REQUEST_RATE_LIMIT")) {
        throw new Error("نشرت طلبات كافية خلال الساعة الماضية — حاول لاحقًا");
      }
      throw new Error("تعذّر نشر الطلب — حاول مرة أخرى");
    }
    // المعرّف يفتح ترقية «الطلب الجاد» بعد النشر مباشرة؛ وهو معلومة عامة أصلًا في السوق.
    return { ok: true, id: row.id };
  });

/**
 * «الطلب الجاد»: فاتورة ميسر من صاحب الطلب نفسه (زائر بلا حساب) تثبّت طلبه أول السوق بشارة
 * 30 يومًا وتُشعر كل المكاتب الظاهرة في الموقع — بضمان إعادة المبلغ إذا تواصل معه أقل من 3
 * مكاتب خلال الفترة. بلا تسجيل دخول عمدًا: الدفع نفسه هو الحارس، وفاتورة واحدة مفتوحة لكل طلب.
 */
export const startSeriousRequestPayment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ requestId: z.guid() }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: req, error } = await supabaseAdmin
      .from("market_requests")
      .select("id, status, purpose, unit_type, city, district")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error) throw new Error("تعذّر فتح الدفع — حاول مرة أخرى");
    if (!req || req.status !== "open") throw new Error("الطلب غير موجود أو أُغلق");

    const label =
      (req.unit_type || (req.purpose === "sale" ? "طلب شراء" : "طلب إيجار")) +
      (req.district ? ` في حي ${req.district}` : req.city ? ` في ${req.city}` : "");
    const { openSeriousRequestInvoice } = await import("./listing-payments.server");
    return openSeriousRequestInvoice({ requestId: req.id, label });
  });

/** العودة من ميسر: الخادم يسأل ميسر إن دُفعت الفاتورة ويفعّل «الطلب الجاد» — الرابط وحده لا يثبت شيئًا. */
export const confirmSeriousRequestPayment = createServerFn({ method: "POST" })
  .validator((input: unknown) => z.object({ paymentId: z.guid() }).parse(input))
  .handler(async ({ data }) => {
    const { findListingPayment, settleIfInvoicePaid } = await import("./listing-payments.server");
    const row = await findListingPayment({ id: data.paymentId });
    if (!row || row.kind !== "request") throw new Error("عملية الدفع غير موجودة");
    const paidUntil = await settleIfInvoicePaid(row);
    if (paidUntil) return { status: "paid" as const, paidUntil };
    return ["cancelled", "refunded", "voided"].includes(row.status)
      ? { status: "cancelled" as const }
      : { status: "pending" as const };
  });
