import * as React from "react";

import { CodeEmail } from "@/lib/email-templates/code-email";
import { EmailChangeEmail } from "@/lib/email-templates/email-change";
import { InviteEmail } from "@/lib/email-templates/invite";
import { MagicLinkEmail } from "@/lib/email-templates/magic-link";
import { ReauthenticationEmail } from "@/lib/email-templates/reauthentication";

/**
 * Supabase "Send Email Hook" → our Arabic templates → Resend.
 *
 * Supabase signs every hook call with Standard Webhooks (headers webhook-id / webhook-timestamp /
 * webhook-signature; the secret is shown in the dashboard as "v1,whsec_…"). Settings:
 *   SEND_EMAIL_HOOK_SECRET  the hook secret from Authentication → Hooks
 *   RESEND_API_KEY          Resend API key (sending domain notify.jarak-ksa.com verified there)
 *   EMAIL_FROM              optional, default «جارك <noreply@notify.jarak-ksa.com>»
 */

export const SITE_NAME = "جارك";
export const SITE_URL = "https://jarak-ksa.com";
const DEFAULT_FROM = `"${SITE_NAME}" <noreply@notify.jarak-ksa.com>`;
/** Reject hook calls signed more than this long ago (replay protection). */
const TOLERANCE_SECONDS = 5 * 60;

export type HookPayload = {
  user: { email: string; new_email?: string | null };
  email_data: {
    token: string;
    token_hash: string;
    redirect_to: string;
    email_action_type: string;
    site_url: string;
    token_new?: string;
    token_hash_new?: string;
  };
};

export class HookError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToBase64(bytes: ArrayBuffer): string {
  let bin = "";
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Signs like Supabase does — used by verifyHook and by the tests. */
export async function signHook(secret: string, id: string, timestamp: string, body: string) {
  const keyB64 = secret.replace(/^v1,/, "").replace(/^whsec_/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(keyB64),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return bytesToBase64(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)),
  );
}

/** Verifies a Standard Webhooks signature and returns the parsed payload. */
export async function verifyHook(
  body: string,
  headers: Headers,
  secret: string,
  now = Date.now(),
): Promise<HookPayload> {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) throw new HookError(401, "missing signature headers");

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > TOLERANCE_SECONDS) {
    throw new HookError(401, "stale or invalid timestamp");
  }

  const expected = await signHook(secret, id, timestamp, body);
  // The header may carry several space-separated "v1,<base64>" signatures (key rotation).
  const ok = signatures
    .split(" ")
    .some((s) => s.startsWith("v1,") && safeEqual(s.slice(3), expected));
  if (!ok) throw new HookError(401, "invalid signature");

  try {
    const payload = JSON.parse(body) as HookPayload;
    if (!payload?.user?.email || !payload?.email_data?.email_action_type) throw new Error();
    return payload;
  } catch {
    throw new HookError(400, "invalid payload");
  }
}

/** The link a recipient clicks — Supabase verifies it, then redirects to `redirect_to`. */
export function verifyUrl(
  supabaseUrl: string,
  tokenHash: string,
  type: string,
  redirectTo: string,
) {
  const u = new URL("/auth/v1/verify", supabaseUrl);
  u.searchParams.set("token", tokenHash);
  u.searchParams.set("type", type);
  if (redirectTo) u.searchParams.set("redirect_to", redirectTo);
  return u.toString();
}

export type OutgoingEmail = { to: string; subject: string; element: React.ReactElement };

/** Which emails to send for a hook call — the same subjects and templates the site used before. */
export function buildEmails(p: HookPayload, supabaseUrl: string): OutgoingEmail[] {
  const d = p.email_data;
  const url = (hash: string) =>
    verifyUrl(supabaseUrl, hash, d.email_action_type, d.redirect_to || d.site_url);

  switch (d.email_action_type) {
    case "signup":
      return [
        {
          to: p.user.email,
          subject: "رمز تفعيل حسابك في جارك",
          element: React.createElement(CodeEmail, {
            siteName: SITE_NAME,
            title: "فعّل حسابك",
            intro: "أهلًا بك في جارك! أدخل هذا الرمز في صفحة التسجيل لتفعيل حسابك:",
            token: d.token,
            footerNote: "إذا ما سجّلت في جارك، تجاهل هذه الرسالة.",
          }),
        },
      ];
    case "recovery":
      return [
        {
          to: p.user.email,
          subject: "رمز إعادة تعيين كلمة المرور",
          element: React.createElement(CodeEmail, {
            siteName: SITE_NAME,
            title: "إعادة تعيين كلمة المرور",
            intro: "أدخل هذا الرمز في صفحة الدخول لتعيين كلمة مرور جديدة:",
            token: d.token,
            footerNote: "إذا ما طلبت إعادة التعيين، تجاهل هذه الرسالة وكلمة مرورك تبقى كما هي.",
          }),
        },
      ];
    case "invite":
      return [
        {
          to: p.user.email,
          subject: "دعوة للانضمام إلى جارك",
          element: React.createElement(InviteEmail, {
            siteName: SITE_NAME,
            siteUrl: SITE_URL,
            confirmationUrl: url(d.token_hash),
          }),
        },
      ];
    case "magiclink":
      return [
        {
          to: p.user.email,
          subject: "رابط الدخول إلى جارك",
          element: React.createElement(MagicLinkEmail, {
            siteName: SITE_NAME,
            confirmationUrl: url(d.token_hash),
          }),
        },
      ];
    case "reauthentication":
      return [
        {
          to: p.user.email,
          subject: "رمز التحقق من جارك",
          element: React.createElement(ReauthenticationEmail, { token: d.token }),
        },
      ];
    case "email_change": {
      // Supabase's documented quirk: token_hash goes with the NEW address and token_hash_new with
      // the CURRENT one. With "Secure email change" on, both addresses must confirm.
      const newEmail = p.user.new_email ?? "";
      const mail = (to: string, hash: string): OutgoingEmail => ({
        to,
        subject: "أكّد بريدك الجديد",
        element: React.createElement(EmailChangeEmail, {
          siteName: SITE_NAME,
          oldEmail: p.user.email,
          email: p.user.email,
          newEmail,
          confirmationUrl: url(hash),
        }),
      });
      const out: OutgoingEmail[] = [];
      if (newEmail && d.token_hash) out.push(mail(newEmail, d.token_hash));
      if (d.token_hash_new) out.push(mail(p.user.email, d.token_hash_new));
      return out;
    }
    default:
      throw new HookError(400, `unsupported email type: ${d.email_action_type}`);
  }
}

/** Renders and sends through Resend. */
export async function sendViaResend(email: OutgoingEmail, apiKey: string, from = DEFAULT_FROM) {
  const { render } = await import("@react-email/render");
  const html = await render(email.element);
  const text = await render(email.element, { plainText: true });
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [email.to], subject: email.subject, html, text }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new HookError(502, `email provider rejected the message (${res.status}): ${detail}`);
  }
}
