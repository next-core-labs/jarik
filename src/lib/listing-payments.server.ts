import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SITE_URL } from "./auth-email.server";
import { LISTING_FEE_HALALAS } from "./listing-fee";
import {
  MOYASAR_NOT_CONFIGURED,
  cancelMoyasarInvoice,
  createMoyasarInvoice,
  fetchMoyasarInvoice,
  moyasarConfigured,
} from "./moyasar.server";

/** Tags Jarak's invoices in the Moyasar account it shares with usil. */
export const LISTING_METADATA_SOURCE = "jarak_listing";

/** A row whose invoice never got attached (the worker died mid-request) blocks the unit this long. */
const STALE_OPEN_ROW_MS = 2 * 60_000;

type ListingPaymentRow = {
  id: string;
  unit_id: string;
  status: string;
  amount_halalas: number;
  currency: string;
  moyasar_invoice_id: string | null;
  invoice_url: string | null;
  created_at: string;
};

const ROW_COLUMNS =
  "id, unit_id, status, amount_halalas, currency, moyasar_invoice_id, invoice_url, created_at";

/** Moyasar only redirects to https; anything else (local dev) returns to the live site. */
function siteOrigin(): string {
  try {
    const url = new URL(getRequest().url);
    if (url.protocol === "https:") return url.origin;
  } catch {
    /* no request */
  }
  return SITE_URL;
}

/** Marks the row paid and extends the unit's publication. Idempotent; returns the new end date. */
export async function settleListingPayment(
  paymentId: string,
  moyasarPaymentId: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc("settle_listing_payment", {
    _payment_id: paymentId,
    _moyasar_payment_id: moyasarPaymentId,
  });
  if (error) throw error;
  return data;
}

/** Asks Moyasar whether the row's invoice is paid, at the stored amount, and settles it if so. */
export async function settleIfInvoicePaid(row: ListingPaymentRow): Promise<string | null> {
  // A cancelled row is still checked: money Moyasar took for it must still publish the unit.
  if (!row.moyasar_invoice_id) return null;
  if (row.status === "paid") return settleListingPayment(row.id, "");
  const invoice = await fetchMoyasarInvoice(row.moyasar_invoice_id);
  if (!invoice || invoice.status !== "paid") return null;
  if (invoice.amount !== row.amount_halalas || invoice.currency !== row.currency) {
    console.warn(
      "[listing-payment] invoice amount mismatch",
      row.id,
      invoice.amount,
      invoice.currency,
    );
    return null;
  }
  return settleListingPayment(row.id, invoice.paymentIds[0] ?? "");
}

export async function findListingPayment(
  by: { id: string } | { invoiceId: string },
): Promise<ListingPaymentRow | null> {
  const query = supabaseAdmin.from("listing_payments").select(ROW_COLUMNS);
  const { data, error } =
    "id" in by
      ? await query.eq("id", by.id).maybeSingle()
      : await query.eq("moyasar_invoice_id", by.invoiceId).maybeSingle();
  if (error) throw error;
  return data;
}

async function cancelRow(id: string) {
  await supabaseAdmin.from("listing_payments").update({ status: "cancelled" }).eq("id", id);
}

/**
 * The payment link for a unit's next publication period. Reuses the unit's open invoice (one payable
 * link per unit, so the office cannot pay twice); if that one was paid meanwhile it is settled instead.
 */
export async function openListingInvoice(input: {
  unitId: string;
  orgId: string;
  userId: string;
  unitLabel: string;
}): Promise<{ status: "paid"; paidUntil: string | null } | { status: "pending"; url: string }> {
  if (!moyasarConfigured()) throw new Error(MOYASAR_NOT_CONFIGURED);

  const { data: open, error: openError } = await supabaseAdmin
    .from("listing_payments")
    .select(ROW_COLUMNS)
    .eq("unit_id", input.unitId)
    .eq("status", "initiated")
    .maybeSingle();
  if (openError) throw openError;

  if (open) {
    if (open.moyasar_invoice_id) {
      const invoice = await fetchMoyasarInvoice(open.moyasar_invoice_id);
      if (invoice?.status === "paid") {
        return { status: "paid", paidUntil: await settleIfInvoicePaid(open) };
      }
      if (invoice?.status === "initiated" && open.invoice_url) {
        return { status: "pending", url: open.invoice_url };
      }
      // Expired, cancelled or failed at Moyasar: close it and raise a fresh one.
      await cancelRow(open.id);
    } else if (Date.now() - new Date(open.created_at).getTime() > STALE_OPEN_ROW_MS) {
      await cancelRow(open.id);
    } else {
      throw new Error("جارٍ إنشاء رابط الدفع لهذه الوحدة. حاول بعد لحظات.");
    }
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from("listing_payments")
    .insert({
      unit_id: input.unitId,
      org_id: input.orgId,
      created_by: input.userId,
      amount_halalas: LISTING_FEE_HALALAS,
    })
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error("جارٍ إنشاء رابط الدفع لهذه الوحدة. حاول بعد لحظات.");
    }
    throw insertError;
  }

  const origin = siteOrigin();
  let invoice;
  try {
    invoice = await createMoyasarInvoice({
      amountHalalas: LISTING_FEE_HALALAS,
      description: `نشر عرض في جارك لمدة 30 يومًا — ${input.unitLabel}`,
      successUrl: `${origin}/properties?listing_payment=${row.id}`,
      backUrl: `${origin}/properties`,
      metadata: {
        source: LISTING_METADATA_SOURCE,
        listing_payment_id: row.id,
        unit_id: input.unitId,
      },
    });
  } catch (e) {
    await supabaseAdmin.from("listing_payments").delete().eq("id", row.id);
    throw e;
  }

  const { error: attachError } = await supabaseAdmin
    .from("listing_payments")
    .update({ moyasar_invoice_id: invoice.id, invoice_url: invoice.url })
    .eq("id", row.id);
  if (attachError) {
    await cancelMoyasarInvoice(invoice.id);
    await supabaseAdmin.from("listing_payments").delete().eq("id", row.id);
    throw attachError;
  }
  return { status: "pending", url: invoice.url };
}
