import { isMoyasarCheckoutUrl as isMoyasarUrl } from "./moyasar-url";
import { safeEqual } from "./webhook-auth.server";

/**
 * Moyasar hosted invoices — the same flow as usil (one Moyasar account serves both apps): the server
 * raises an invoice, the office pays on Moyasar's page, and nothing is marked paid until the payment
 * is fetched back from Moyasar. Card data never reaches Jarak. Amounts are in halalas (1 SAR = 100).
 */

const MOYASAR_API = "https://api.moyasar.com/v1";

export const MOYASAR_NOT_CONFIGURED = "الدفع الإلكتروني غير مفعّل حاليًا. تواصل مع إدارة جارك.";

export type MoyasarInvoice = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  url: string;
  /** Payment ids Moyasar recorded against this invoice. */
  paymentIds: string[];
};

export type MoyasarPayment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  invoiceId: string | null;
  metadata: Record<string, string>;
};

function secretKey(): string {
  return String(process.env["MOYASAR_SECRET_KEY"] ?? "").trim();
}

export function moyasarConfigured(): boolean {
  return /^sk_(test|live)_[A-Za-z0-9]{24,}$/.test(secretKey());
}

function authHeader(): string {
  if (!moyasarConfigured()) throw new Error(MOYASAR_NOT_CONFIGURED);
  return `Basic ${btoa(`${secretKey()}:`)}`;
}

export function isSafeMoyasarId(id: string): boolean {
  return /^[a-zA-Z0-9_-]{8,80}$/.test(id);
}

/** Webhook shared secret (set when registering Jarak's webhook in Moyasar). Unset rejects every call. */
export function moyasarWebhookAuthorized(token: unknown): boolean {
  const expected = String(process.env["MOYASAR_WEBHOOK_SECRET"] ?? "").trim();
  if (expected.length < 8) return false;
  return safeEqual(expected, String(token ?? ""));
}

function asMetadata(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return out;
}

export async function createMoyasarInvoice(input: {
  amountHalalas: number;
  description: string;
  successUrl: string;
  backUrl: string;
  metadata: Record<string, string>;
}): Promise<MoyasarInvoice> {
  let res: Response;
  try {
    res = await fetch(`${MOYASAR_API}/invoices`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({
        amount: input.amountHalalas,
        currency: "SAR",
        description: input.description.slice(0, 220),
        success_url: input.successUrl,
        back_url: input.backUrl,
        metadata: input.metadata,
      }),
    });
  } catch {
    throw new Error("تعذّر الاتصال ببوابة الدفع. حاول مرة أخرى.");
  }
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    url?: string;
    message?: string;
  };
  const url = String(data.url ?? "");
  if (!res.ok || !data.id || !isMoyasarUrl(url)) {
    // Moyasar's own text goes to the log, not to the office.
    console.warn("[moyasar] invoice refused", res.status, data.message ?? "");
    throw new Error("تعذّر إنشاء رابط الدفع. حاول بعد قليل.");
  }
  return {
    id: String(data.id),
    status: String(data.status ?? "initiated"),
    amount: input.amountHalalas,
    currency: "SAR",
    url,
    paymentIds: [],
  };
}

/** GET /v1/invoices/:id — the paid state comes from Moyasar, never from the browser. */
export async function fetchMoyasarInvoice(id: string): Promise<MoyasarInvoice | null> {
  if (!isSafeMoyasarId(id)) return null;
  const res = await fetch(`${MOYASAR_API}/invoices/${encodeURIComponent(id)}`, {
    headers: { Authorization: authHeader() },
  });
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    amount?: number;
    currency?: string;
    url?: string;
    payments?: { id?: string; status?: string }[];
    message?: string;
  };
  if (!res.ok || !data.id) {
    console.warn("[moyasar] invoice lookup failed", res.status, data.message ?? "");
    throw new Error("تعذّر التحقق من الدفع الآن. حاول بعد قليل.");
  }
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    amount: Number(data.amount) || 0,
    currency: String(data.currency ?? ""),
    url: isMoyasarUrl(String(data.url ?? "")) ? String(data.url) : "",
    paymentIds: (data.payments ?? [])
      .filter((p) => p.status === "paid" && p.id)
      .map((p) => String(p.id)),
  };
}

/** GET /v1/payments/:id — what a webhook names is looked up, never taken from the event body. */
export async function fetchMoyasarPayment(id: string): Promise<MoyasarPayment | null> {
  if (!isSafeMoyasarId(id)) return null;
  const res = await fetch(`${MOYASAR_API}/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: authHeader() },
  });
  if (res.status === 404) return null;
  const data = (await res.json().catch(() => ({}))) as {
    id?: string;
    status?: string;
    amount?: number;
    currency?: string;
    invoice_id?: string | null;
    metadata?: unknown;
    message?: string;
  };
  if (!res.ok || !data.id) {
    console.warn("[moyasar] payment lookup failed", res.status, data.message ?? "");
    throw new Error("تعذّر التحقق من الدفع الآن. حاول بعد قليل.");
  }
  return {
    id: String(data.id),
    status: String(data.status ?? ""),
    amount: Number(data.amount) || 0,
    currency: String(data.currency ?? ""),
    invoiceId: data.invoice_id ? String(data.invoice_id) : null,
    metadata: asMetadata(data.metadata),
  };
}

/** PUT /v1/invoices/:id/cancel — best effort, so an abandoned link can no longer take money. */
export async function cancelMoyasarInvoice(id: string): Promise<void> {
  if (!isSafeMoyasarId(id) || !moyasarConfigured()) return;
  await fetch(`${MOYASAR_API}/invoices/${encodeURIComponent(id)}/cancel`, {
    method: "PUT",
    headers: { Authorization: authHeader(), Accept: "application/json" },
  }).catch(() => undefined);
}
