import { createHash, timingSafeEqual } from "node:crypto";

/** Longest inbound message we act on (each accepted message can trigger notifications and an LLM call). */
export const MAX_WEBHOOK_TEXT_CHARS = 2000;
/** Reject request bodies larger than this before parsing them. */
export const MAX_WEBHOOK_BODY_BYTES = 64_000;

/** Constant-time string comparison. Hashing first means differing lengths do not leak either. */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * A channel can receive inbound WhatsApp calls only if it has a real verify token AND the caller
 * presents it. A channel with a null/empty/short token is treated as unauthenticated and rejected
 * (previously a null token meant "no check at all", so anyone who knew the URL could inject messages).
 */
export function isValidChannelToken(
  expected: string | null | undefined,
  provided: string | null | undefined,
): boolean {
  if (!expected || expected.length < 8) return false;
  return safeEqual(expected, provided ?? "");
}
