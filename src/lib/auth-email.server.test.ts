import { describe, expect, it } from "vitest";

import {
  HookError,
  buildEmails,
  signHook,
  verifyHook,
  type HookPayload,
} from "./auth-email.server";

const SECRET = `v1,whsec_${btoa("super-secret-key-for-tests-0123456789")}`;
const payload: HookPayload = {
  user: { email: "a@example.com", new_email: "b@example.com" },
  email_data: {
    token: "123456",
    token_hash: "hash-new",
    redirect_to: "https://jarak-ksa.com/dashboard",
    email_action_type: "signup",
    site_url: "https://jarak-ksa.com",
    token_hash_new: "hash-current",
  },
};

async function signed(body: string, now: number) {
  const ts = String(Math.floor(now / 1000));
  const sig = await signHook(SECRET, "msg_1", ts, body);
  return new Headers({
    "webhook-id": "msg_1",
    "webhook-timestamp": ts,
    "webhook-signature": `v1,${sig}`,
  });
}

describe("verifyHook", () => {
  it("accepts a correctly signed, fresh call", async () => {
    const body = JSON.stringify(payload);
    const now = Date.now();
    await expect(verifyHook(body, await signed(body, now), SECRET, now)).resolves.toEqual(payload);
  });

  it("rejects a tampered body, a wrong secret and a stale timestamp", async () => {
    const body = JSON.stringify(payload);
    const now = Date.now();
    const headers = await signed(body, now);
    await expect(verifyHook(body + " ", headers, SECRET, now)).rejects.toBeInstanceOf(HookError);
    await expect(
      verifyHook(body, headers, `v1,whsec_${btoa("another-key")}`, now),
    ).rejects.toBeInstanceOf(HookError);
    await expect(verifyHook(body, headers, SECRET, now + 10 * 60_000)).rejects.toBeInstanceOf(
      HookError,
    );
  });
});

describe("buildEmails", () => {
  it("sends the sign-up code to the user", () => {
    const [mail, ...rest] = buildEmails(payload, "https://x.supabase.co");
    expect(rest).toHaveLength(0);
    expect(mail?.to).toBe("a@example.com");
    expect(mail?.subject).toContain("رمز تفعيل");
  });

  it("asks both addresses to confirm an email change", () => {
    const change = {
      ...payload,
      email_data: { ...payload.email_data, email_action_type: "email_change" },
    };
    const mails = buildEmails(change, "https://x.supabase.co");
    expect(mails.map((m) => m.to)).toEqual(["b@example.com", "a@example.com"]);
  });
});
