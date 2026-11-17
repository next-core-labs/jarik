import { getRequest } from "@tanstack/react-start/server";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { SITE_URL } from "./auth-email.server";
import {
  FEATURE_FEE_HALALAS,
  LISTING_FEE_HALALAS,
  SERIOUS_REQUEST_FEE_HALALAS,
} from "./listing-fee";
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

/** An unpaid payment link is cancelled and replaced after a day, so a weeks-old link can't be paid. */
const INVOICE_TTL_MS = 24 * 60 * 60_000;

type ListingPaymentRow = {
  id: string;
  /** NULL once the unit was deleted; the row stays so a late payment is still recorded. */
  unit_id: string | null;
  /** طلب سوق الطلبات الذي تُدفع له رسوم «طلب جاد» (kind=request)؛ NULL لرسوم الوحدات. */
  request_id: string | null;
  /** publish: رسوم نشر فترة في الموقع. feature: رسوم تمييز الإعلان. request: رسوم طلب جاد. */
  kind: string;
  status: string;
  amount_halalas: number;
  currency: string;
  moyasar_invoice_id: string | null;
  moyasar_payment_id: string | null;
  invoice_url: string | null;
  refund_reason: string | null;
  created_at: string;
};

const ROW_COLUMNS =
  "id, unit_id, request_id, kind, status, amount_halalas, currency, moyasar_invoice_id, moyasar_payment_id, invoice_url, refund_reason, created_at";

/** Money taken for a unit/request that could no longer be published/featured (settle: needs_refund). */
function notPublishedError(kind: string, reason: string | null): Error {
  const what =
    kind === "request"
      ? "لم يُفعَّل الطلب الجاد"
      : kind === "feature"
        ? "لم يُميَّز الإعلان"
        : "لم تُنشر الوحدة";
  return new Error(
    `تم استلام الدفع لكن ${what}${reason ? `: ${reason}` : ""}. أبلغنا إدارة جارك وستعيد المبلغ.`,
  );
}

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

/**
 * Marks the row paid and extends the unit's publication. Idempotent; returns the new end date, or null
 * when the unit could no longer be published (the row is then needs_refund and the platform is told).
 */
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

/** Moyasar refunded or voided the payment: takes its paid days back. Idempotent. */
export async function revokeListingPayment(
  paymentId: string,
  status: "refunded" | "voided",
): Promise<void> {
  const { error } = await supabaseAdmin.rpc("revoke_listing_payment", {
    _payment_id: paymentId,
    _status: status,
  });
  if (error) throw error;
}

/**
 * Asks Moyasar whether the row's invoice is paid, at the stored amount, and settles it if so. Throws
 * when the money arrived but the unit could no longer be published.
 */
export async function settleIfInvoicePaid(row: ListingPaymentRow): Promise<string | null> {
  if (row.status === "needs_refund") throw notPublishedError(row.kind, row.refund_reason);
  if (row.status === "refunded" || row.status === "voided") return null;
  // A cancelled row is still checked: money Moyasar took for it must still be settled.
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
  const paidUntil = await settleListingPayment(row.id, invoice.paymentIds[0] ?? "");
  if (paidUntil) return paidUntil;
  const settled = await findListingPayment({ id: row.id });
  if (settled?.status === "needs_refund")
    throw notPublishedError(settled.kind, settled.refund_reason);
  return null;
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
  return openInvoice("publish", input);
}

/** The payment link for featuring a unit's listing («تمييز الإعلان») for the next 30 days. */
export async function openFeatureInvoice(input: {
  unitId: string;
  orgId: string;
  userId: string;
  unitLabel: string;
}): Promise<{ status: "paid"; paidUntil: string | null } | { status: "pending"; url: string }> {
  return openInvoice("feature", input);
}

/**
 * رابط دفع «الطلب الجاد» لصاحب طلب في سوق الطلبات (زائر بلا حساب): 30 يومًا تثبيتًا أول السوق
 * وإشعارًا لكل المكاتب الظاهرة في الموقع. label يظهر في وصف فاتورة ميسر وإشعارات المنصة.
 */
export async function openSeriousRequestInvoice(input: {
  requestId: string;
  label: string;
}): Promise<{ status: "paid"; paidUntil: string | null } | { status: "pending"; url: string }> {
  return openInvoice("request", { requestId: input.requestId, label: input.label });
}

type InvoiceTarget =
  | { unitId: string; orgId: string; userId: string; unitLabel: string }
  | { requestId: string; label: string };

async function openInvoice(
  kind: "publish" | "feature" | "request",
  input: InvoiceTarget,
): Promise<{ status: "paid"; paidUntil: string | null } | { status: "pending"; url: string }> {
  if (!moyasarConfigured()) throw new Error(MOYASAR_NOT_CONFIGURED);

  const forRequest = "requestId" in input;
  const amountHalalas = forRequest
    ? SERIOUS_REQUEST_FEE_HALALAS
    : kind === "feature"
      ? FEATURE_FEE_HALALAS
      : LISTING_FEE_HALALAS;

  const openQuery = supabaseAdmin
    .from("listing_payments")
    .select(ROW_COLUMNS)
    .eq("kind", kind)
    .eq("status", "initiated");
  const { data: open, error: openError } = await (
    forRequest ? openQuery.eq("request_id", input.requestId) : openQuery.eq("unit_id", input.unitId)
  ).maybeSingle();
  if (openError) throw openError;

  if (open) {
    if (open.moyasar_invoice_id) {
      const invoice = await fetchMoyasarInvoice(open.moyasar_invoice_id);
      if (invoice?.status === "paid") {
        return { status: "paid", paidUntil: await settleIfInvoicePaid(open) };
      }
      const fresh = Date.now() - new Date(open.created_at).getTime() < INVOICE_TTL_MS;
      if (invoice?.status === "initiated" && open.invoice_url && fresh) {
        return { status: "pending", url: open.invoice_url };
      }
      // Expired, cancelled or failed at Moyasar, or over a day old: close it and raise a fresh one.
      if (invoice?.status === "initiated") await cancelMoyasarInvoice(open.moyasar_invoice_id);
      await cancelRow(open.id);
    } else if (Date.now() - new Date(open.created_at).getTime() > STALE_OPEN_ROW_MS) {
      await cancelRow(open.id);
    } else {
      throw new Error("جارٍ إنشاء رابط الدفع. حاول بعد لحظات.");
    }
  }

  const { data: row, error: insertError } = await supabaseAdmin
    .from("listing_payments")
    .insert(
      forRequest
        ? {
            request_id: input.requestId,
            kind,
            amount_halalas: amountHalalas,
            unit_label: input.label,
          }
        : {
            unit_id: input.unitId,
            org_id: input.orgId,
            created_by: input.userId,
            kind,
            amount_halalas: amountHalalas,
            unit_label: input.unitLabel,
          },
    )
    .select("id")
    .single();
  if (insertError) {
    if (insertError.code === "23505") {
      throw new Error("جارٍ إنشاء رابط الدفع. حاول بعد لحظات.");
    }
    throw insertError;
  }

  const origin = siteOrigin();
  let invoice;
  try {
    invoice = await createMoyasarInvoice({
      amountHalalas,
      description: forRequest
        ? `طلب جاد في سوق طلبات جارك لمدة 30 يومًا — ${input.label}`
        : kind === "feature"
          ? `تمييز إعلان في جارك لمدة 30 يومًا — ${input.unitLabel}`
          : `نشر عرض في جارك لمدة 30 يومًا — ${input.unitLabel}`,
      successUrl: forRequest
        ? `${origin}/requests-market?request_payment=${row.id}`
        : `${origin}/properties?listing_payment=${row.id}`,
      backUrl: forRequest ? `${origin}/requests-market` : `${origin}/properties`,
      metadata: {
        source: LISTING_METADATA_SOURCE,
        listing_payment_id: row.id,
        ...(forRequest ? { request_id: input.requestId } : { unit_id: input.unitId }),
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
