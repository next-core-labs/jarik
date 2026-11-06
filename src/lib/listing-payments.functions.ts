import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** Raises (or reuses) the Moyasar invoice for publishing a unit for the next 30 days. */
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
    // Paying would buy nothing: the website only shows offices that are public and approved.
    if (!target.office_ready) {
      throw new Error(
        "لن تظهر الوحدة في الموقع قبل تفعيل «العرض العلني» في هوية المكتب واعتماده من المنصة — أكمل ذلك أولًا ثم ادفع رسوم النشر.",
      );
    }
    const { openListingInvoice } = await import("./listing-payments.server");
    return openListingInvoice({
      unitId: data.unitId,
      orgId: target.org_id,
      userId: context.userId,
      unitLabel: target.unit_label,
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
    const paidUntil = await settleIfInvoicePaid(row);
    return paidUntil
      ? { status: "paid" as const, paidUntil }
      : { status: row.status === "cancelled" ? ("cancelled" as const) : ("pending" as const) };
  });
