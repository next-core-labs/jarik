import { afterEach, describe, expect, it, vi } from "vitest";

import { createFakeSupabase, insertPayloads } from "./__testutils__/fakeSupabase";

let fakeSupabase: ReturnType<typeof createFakeSupabase>;

const ORG = "org-1";

vi.mock("@/integrations/supabase/client.server", () => ({
  get supabaseAdmin() {
    return fakeSupabase;
  },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadModule() {
  return import("./whatsapp-out.server");
}

describe("whatsappProviderStatus / isWhatsappLocked", () => {
  it("reports unconfigured and locked by default when org_settings has no row", async () => {
    fakeSupabase = createFakeSupabase({ org_settings: { data: null, error: null } });
    const { whatsappProviderStatus, WHATSAPP_LOCKED_MSG } = await loadModule();
    await expect(whatsappProviderStatus(ORG)).resolves.toEqual({
      configured: false,
      provider: null,
      locked: true,
      message: WHATSAPP_LOCKED_MSG,
    });
  });

  it("treats whatsapp_locked === false as unlocked", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: false }, error: null },
    });
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    const { whatsappProviderStatus } = await loadModule();
    await expect(whatsappProviderStatus(ORG)).resolves.toEqual({
      configured: true,
      provider: "meta",
      locked: false,
      message: null,
    });
  });

  it("prefers the Meta provider over Twilio when both are configured", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: false }, error: null },
    });
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "sid");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "auth");
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+1000");
    const { whatsappProviderStatus } = await loadModule();
    await expect(whatsappProviderStatus(ORG)).resolves.toMatchObject({ provider: "meta" });
  });

  it("falls back to locked=true if reading org_settings throws", async () => {
    fakeSupabase = {
      from: () => {
        throw new Error("db down");
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
      calls: [],
    } as unknown as ReturnType<typeof createFakeSupabase>;
    const { isWhatsappLocked } = await loadModule();
    await expect(isWhatsappLocked(ORG)).resolves.toBe(true);
  });
});

describe("sendWhatsappOut", () => {
  it("refuses to send and logs nothing when the link is locked", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: true }, error: null },
    });
    const { sendWhatsappOut, WHATSAPP_LOCKED_MSG } = await loadModule();
    const result = await sendWhatsappOut({ orgId: ORG, phone: "0501234567", body: "أهلًا" });
    expect(result).toEqual({ sent: false, reason: WHATSAPP_LOCKED_MSG });
    expect(insertPayloads(fakeSupabase.calls, "whatsapp_messages")).toHaveLength(0);
    // The lock that decides is the sending office's own, not some other office's settings row.
    expect(fakeSupabase.calls).toContainEqual({
      table: "org_settings",
      method: "eq",
      args: ["id", ORG],
    });
  });

  it("sends via Meta, normalizes the phone to 966-prefixed digits, and logs the outcome", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: false }, error: null },
      whatsapp_messages: { data: null, error: null },
    });
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));

    const { sendWhatsappOut } = await loadModule();
    const result = await sendWhatsappOut({ orgId: ORG, phone: "0501234567", body: "أهلًا" });

    expect(result).toEqual({ sent: true });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("phone-id");
    expect(JSON.parse((init as RequestInit).body as string).to).toBe("966501234567");

    const logs = insertPayloads(fakeSupabase.calls, "whatsapp_messages");
    expect(logs[0]).toMatchObject({
      phone: "966501234567",
      direction: "out",
      action_taken: "أُرسلت على واتساب",
      org_id: ORG,
    });
  });

  it("falls back to Twilio when Meta is not configured", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: false }, error: null },
      whatsapp_messages: { data: null, error: null },
    });
    vi.stubEnv("TWILIO_ACCOUNT_SID", "sid");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "auth");
    vi.stubEnv("TWILIO_WHATSAPP_FROM", "whatsapp:+1000");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "" }));

    const { sendWhatsappOut } = await loadModule();
    const result = await sendWhatsappOut({ orgId: ORG, phone: "0501234567", body: "أهلًا" });

    expect(result).toEqual({ sent: true });
    const [url] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(url).toContain("api.twilio.com");
  });

  it("reports failure with the provider's status when the send request is rejected", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: false }, error: null },
      whatsapp_messages: { data: null, error: null },
    });
    vi.stubEnv("WHATSAPP_PHONE_NUMBER_ID", "phone-id");
    vi.stubEnv("WHATSAPP_ACCESS_TOKEN", "token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, text: async () => "invalid token" }),
    );

    const { sendWhatsappOut } = await loadModule();
    const result = await sendWhatsappOut({ orgId: ORG, phone: "0501234567", body: "أهلًا" });
    expect(result.sent).toBe(false);
    expect(result.reason).toContain("Meta: 401");
  });

  it("reports 'no provider configured' when locked=false but nothing is set up", async () => {
    fakeSupabase = createFakeSupabase({
      org_settings: { data: { whatsapp_locked: false }, error: null },
      whatsapp_messages: { data: null, error: null },
    });
    const { sendWhatsappOut } = await loadModule();
    const result = await sendWhatsappOut({ orgId: ORG, phone: "0501234567", body: "أهلًا" });
    expect(result).toEqual({ sent: false, reason: "لم يُضبط مزوّد واتساب بعد" });
  });
});
