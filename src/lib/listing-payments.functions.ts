import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Retired for offices (they publish free since 20261111100000): it now always refuses, so no new
 * Moyasar invoice can turn a free listing into a 30-day one. Kept for a future owner paid flow.
 * Previously: raised (or reused) the Moyasar invoice for publishing a unit for the next 30 days. The unit must be
 * vacant and managed by the caller's office (with `leasing` for an owner's unit under an agreement);
 * listing_publish_target refuses otherwise with the reason.
 */
export const startListingPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // guid, not uuid: zod's uuid() rejects ids Postgres accepts (any 8-4-4-4-12 hex, e.g. imported rows).
  .validator((input) => z.object({ unitId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: target, error } = await context.supabase
      .rpc("listing_publish_target", { _unit_id: data.unitId })
      .maybeSingle();
    if (error) throw error;
    if (!target) throw new Error("الوحدة غير موجودة أو لا يديرها مكتبك");
    // listing_publish_target only answers an office's staff — and offices publish free
    // (20261111100000). A paid period here would turn a free listing into one that expires.
    throw new Error("النشر في الموقع مجاني للمكاتب — استخدم «نشر في الموقع» على الوحدة");
  });

/**
 * «تمييز الإعلان»: فاتورة ميسر تمدّد featured_until ثلاثين يومًا، فيظهر الإعلان أولًا في الفرز
 * الافتراضي للسوق العام. للمكاتب، ولعرض منشور فعلًا في الموقع.
 */
export const startFeaturePayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ unitId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: target, error } = await context.supabase
      .rpc("listing_publish_target", { _unit_id: data.unitId })
      .maybeSingle();
    if (error) throw error;
    if (!target) throw new Error("الوحدة غير موجودة أو لا يديرها مكتبك");

    // التمييز يُدفع لعرض معروض فعلًا — نفس العرض الذي يراه الزائر.
    const { data: listed, error: listedError } = await context.supabase
      .from("vacant_units_public")
      .select("id")
      .eq("id", data.unitId)
      .maybeSingle();
    if (listedError) throw listedError;
    if (!listed) throw new Error("انشر الوحدة في الموقع أولًا، ثم ميّز إعلانها");

    const { openFeatureInvoice } = await import("./listing-payments.server");
    return openFeatureInvoice({
      unitId: data.unitId,
      orgId: target.org_id,
      userId: context.userId,
      unitLabel: target.unit_label ?? "وحدة",
    });
  });

/** After Moyasar sends the office back: checks the invoice with Moyasar and publishes the unit if paid. */
export const confirmListingPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input) => z.object({ paymentId: z.guid() }).parse(input))
  .handler(async ({ data, context }) => {
    // Read through the caller's own access: only their office's staff can see the row.
    const { data: visible, error } = await context.supabase
      .from("listing_payments")
      .select("id")
      .eq("id", data.paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!visible) throw new Error("عملية الدفع غير موجودة");

    const { findListingPayment, settleIfInvoicePaid } = await import("./listing-payments.server");
    const row = await findListingPayment({ id: data.paymentId });
    if (!row) throw new Error("عملية الدفع غير موجودة");
    const kind = row.kind === "feature" ? ("feature" as const) : ("publish" as const);
    const paidUntil = await settleIfInvoicePaid(row);
    if (paidUntil) return { status: "paid" as const, kind, paidUntil };
    return ["cancelled", "refunded", "voided"].includes(row.status)
      ? { status: "cancelled" as const, kind }
      : { status: "pending" as const, kind };
  });
