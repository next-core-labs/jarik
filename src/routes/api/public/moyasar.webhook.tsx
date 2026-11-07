import { createFileRoute } from "@tanstack/react-router";

// Moyasar → Jarak. Register in Moyasar (the account usil also uses) a webhook for payment_paid,
// payment_refunded and payment_voided to https://jarak-ksa.com/api/public/moyasar/webhook with the
// shared secret MOYASAR_WEBHOOK_SECRET. The event body is never trusted: the payment is fetched back
// from Moyasar, and its own status decides (paid publishes; refunded/voided take the paid days back).
// usil's payments arrive here too and are acknowledged without effect (and ours at usil's hook).
export const Route = createFileRoute("/api/public/moyasar/webhook")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { MAX_WEBHOOK_BODY_BYTES } = await import("@/lib/webhook-auth.server");
        const { moyasarWebhookAuthorized, fetchMoyasarPayment } =
          await import("@/lib/moyasar.server");
        const { findListingPayment, revokeListingPayment, settleListingPayment } =
          await import("@/lib/listing-payments.server");

        const rawText = await request.text();
        if (new TextEncoder().encode(rawText).length > MAX_WEBHOOK_BODY_BYTES) {
          return new Response("payload too large", { status: 413 });
        }
        let event: { secret_token?: unknown; data?: { id?: unknown } } | null;
        try {
          event = JSON.parse(rawText);
        } catch {
          return Response.json({ error: "invalid json" }, { status: 400 });
        }
        if (!moyasarWebhookAuthorized(event?.secret_token)) {
          return Response.json({ error: "unauthorized" }, { status: 401 });
        }
        const paymentId = event?.data?.id;
        if (typeof paymentId !== "string") {
          return Response.json({ error: "missing payment id" }, { status: 400 });
        }

        try {
          const payment = await fetchMoyasarPayment(paymentId);
          const status = payment?.status;
          if (!payment || (status !== "paid" && status !== "refunded" && status !== "voided")) {
            return Response.json({ received: true, ignored: true });
          }
          const rowId = payment.metadata["listing_payment_id"];
          const row =
            (payment.invoiceId
              ? await findListingPayment({ invoiceId: payment.invoiceId })
              : null) ?? (rowId ? await findListingPayment({ id: rowId }).catch(() => null) : null);
          // Not one of Jarak's invoices (usil's), so nothing to settle; a 5xx would only make Moyasar retry.
          if (!row) return Response.json({ received: true, ignored: true });
          if (status === "refunded" || status === "voided") {
            // Only the payment that settled the row (if any) can take its days back.
            if (row.moyasar_payment_id && row.moyasar_payment_id !== payment.id) {
              console.warn("[moyasar] webhook: refund of another payment", payment.id, row.id);
              return Response.json({ received: true, ignored: true });
            }
            await revokeListingPayment(row.id, status);
            return Response.json({ received: true });
          }
          if (payment.amount !== row.amount_halalas || payment.currency !== row.currency) {
            console.warn("[moyasar] webhook: amount mismatch", payment.id, row.id);
            return Response.json({ received: true, ignored: true });
          }
          // A unit no longer publishable leaves the row needs_refund and tells the office and platform.
          await settleListingPayment(row.id, payment.id);
          return Response.json({ received: true });
        } catch (e) {
          // Our own faults stay 5xx so Moyasar retries once we are back.
          console.error("[moyasar] webhook failed", e);
          return Response.json({ error: "internal error" }, { status: 500 });
        }
      },
    },
  },
});
