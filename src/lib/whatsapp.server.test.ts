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

async function loadProcessIncomingWhatsapp() {
  const mod = await import("./whatsapp.server");
  return mod.processIncomingWhatsapp;
}

/** The office's own staff: org_members joined with admin/staff roles (see staffIdsOfOrg). */
function officeStaff(ids: string[]) {
  return {
    org_members: { data: ids.map((user_id) => ({ user_id })), error: null },
    user_roles: { data: ids.map((user_id) => ({ user_id })), error: null },
  };
}

describe("processIncomingWhatsapp", () => {
  it("falls back to a generic classification when no AI key is configured, and only notifies staff", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    fakeSupabase = createFakeSupabase({
      tenants: { data: [], error: null },
      "rpc:org_user_ids": { data: [], error: null },
      ...officeStaff(["staff-1"]),
      notifications: [
        { data: [{ id: "notif-1" }], error: null },
        { data: null, error: null },
      ],
      whatsapp_messages: { data: null, error: null },
    });

    const processIncomingWhatsapp = await loadProcessIncomingWhatsapp();
    const result = await processIncomingWhatsapp({
      orgId: ORG,
      phone: "0501234567",
      body: "مرحبا",
    });

    expect(result.actionTaken).toBe("إشعار داخلي للفريق");
    expect(result.matchedName).toBeNull();
    expect(result.create_maintenance).toBe(false);

    const notifications = insertPayloads(fakeSupabase.calls, "notifications");
    expect(notifications).toHaveLength(1);
    expect((notifications[0] as { user_id: string }[])[0]?.user_id).toBe("staff-1");

    const messages = insertPayloads(fakeSupabase.calls, "whatsapp_messages");
    expect(messages[0]).toMatchObject({
      direction: "in",
      body: "مرحبا",
      sender_role: "unknown",
      org_id: ORG,
    });
  });

  it("matches a tenant by phone tail, files a maintenance request, and notifies both staff and the tenant", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: "إبلاغ عطل",
                  sender_role: "tenant",
                  title: "تسريب مياه",
                  summary: "تسريب في الحمام",
                  reply: "تم استلام بلاغك",
                  priority: "high",
                  create_maintenance: true,
                }),
              },
            },
          ],
        }),
      }),
    );

    fakeSupabase = createFakeSupabase({
      tenants: {
        data: [{ id: "t1", user_id: "u1", full_name: "أحمد", phone: "+966 50 123 4567" }],
        error: null,
      },
      "rpc:org_user_ids": { data: [], error: null },
      leases: { data: { unit_id: "unit-1" }, error: null },
      maintenance_requests: { data: { id: "mnt-1" }, error: null },
      ...officeStaff(["staff-1"]),
      notifications: [
        { data: [{ id: "notif-1" }], error: null },
        { data: null, error: null },
      ],
      whatsapp_messages: { data: null, error: null },
    });

    const processIncomingWhatsapp = await loadProcessIncomingWhatsapp();
    const result = await processIncomingWhatsapp({
      orgId: ORG,
      phone: "0501234567",
      body: "فيه تسريب مياه",
    });

    expect(result.actionTaken).toBe("أُنشئ طلب صيانة جديد");
    expect(result.matchedName).toBe("أحمد");

    const maintenance = insertPayloads(fakeSupabase.calls, "maintenance_requests");
    expect(maintenance[0]).toMatchObject({
      org_id: ORG,
      tenant_id: "t1",
      unit_id: "unit-1",
      priority: "high",
      source: "whatsapp",
    });

    const notifications = insertPayloads(fakeSupabase.calls, "notifications") as Array<
      Record<string, unknown> | Record<string, unknown>[]
    >;
    // First insert is the bulk staff notification, second is the tenant's own reply receipt.
    expect(Array.isArray(notifications[0])).toBe(true);
    expect(notifications[1]).toMatchObject({ user_id: "u1", kind: "reply" });
  });

  it("matches by profile when no tenant record shares the phone number", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    fakeSupabase = createFakeSupabase({
      tenants: { data: [], error: null },
      "rpc:org_user_ids": { data: ["p1"], error: null },
      profiles: {
        data: [{ id: "p1", full_name: "سارة", phone: "0559998888" }],
        error: null,
      },
      ...officeStaff([]),
      notifications: { data: null, error: null },
      whatsapp_messages: { data: null, error: null },
    });

    const processIncomingWhatsapp = await loadProcessIncomingWhatsapp();
    const result = await processIncomingWhatsapp({
      orgId: ORG,
      phone: "0559998888",
      body: "سؤال عام",
    });

    expect(result.matchedName).toBe("سارة");
    const notifications = insertPayloads(fakeSupabase.calls, "notifications");
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ user_id: "p1", kind: "reply" });
  });

  it("only looks at the channel's own office: tenants, accounts and staff are all scoped to it", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    fakeSupabase = createFakeSupabase({
      tenants: { data: [], error: null },
      "rpc:org_user_ids": { data: ["p1"], error: null },
      profiles: { data: [], error: null },
      ...officeStaff(["staff-1"]),
      notifications: [
        { data: [{ id: "notif-1" }], error: null },
        { data: null, error: null },
      ],
      whatsapp_messages: { data: null, error: null },
    });

    const processIncomingWhatsapp = await loadProcessIncomingWhatsapp();
    await processIncomingWhatsapp({ orgId: ORG, phone: "0501234567", body: "مرحبا" });

    const { calls } = fakeSupabase;
    // Tenants are matched inside the office, not across the whole platform.
    expect(calls).toContainEqual({ table: "tenants", method: "eq", args: ["org_id", ORG] });
    // Accounts are matched only among the ones connected to this office.
    expect(calls).toContainEqual({
      table: "rpc:org_user_ids",
      method: "rpc",
      args: [{ _org: ORG }],
    });
    expect(calls).toContainEqual({ table: "profiles", method: "in", args: ["id", ["p1"]] });
    // Notified staff come from this office's membership, not from every admin/staff role.
    expect(calls).toContainEqual({ table: "org_members", method: "eq", args: ["org_id", ORG] });
  });

  it("does not query every profile on the platform when the office has no connected accounts", async () => {
    vi.stubEnv("LOVABLE_API_KEY", "");
    fakeSupabase = createFakeSupabase({
      tenants: { data: [], error: null },
      "rpc:org_user_ids": { data: [], error: null },
      profiles: { data: [{ id: "other", full_name: "غريب", phone: "0501234567" }], error: null },
      ...officeStaff([]),
      notifications: { data: null, error: null },
      whatsapp_messages: { data: null, error: null },
    });

    const processIncomingWhatsapp = await loadProcessIncomingWhatsapp();
    const result = await processIncomingWhatsapp({
      orgId: ORG,
      phone: "0501234567",
      body: "مرحبا",
    });

    expect(result.matchedName).toBeNull();
    expect(fakeSupabase.calls.some((c) => c.table === "profiles")).toBe(false);
  });

  it("skips all processing on a replayed webhook delivery (same channel + provider message id)", async () => {
    fakeSupabase = createFakeSupabase({
      // The claim-insert conflicts: this (channel, provider message id) pair was already claimed.
      whatsapp_messages: {
        data: null,
        error: { code: "23505", message: "duplicate key value violates unique constraint" },
      },
    });

    const processIncomingWhatsapp = await loadProcessIncomingWhatsapp();
    const result = await processIncomingWhatsapp({
      orgId: ORG,
      phone: "0501234567",
      body: "فيه تسريب مياه",
      channelId: "chan-1",
      providerMessageId: "wamid.same-message-replayed",
    });

    expect(result.actionTaken).toBe("تم تجاهلها — رسالة مكررة سبق استلامها");
    // Nothing past the claim-insert ran: no tenant lookup, no maintenance request, no notification.
    expect(insertPayloads(fakeSupabase.calls, "whatsapp_messages")).toHaveLength(1);
    expect(fakeSupabase.calls.some((c) => c.table === "tenants")).toBe(false);
    expect(fakeSupabase.calls.some((c) => c.table === "maintenance_requests")).toBe(false);
    expect(fakeSupabase.calls.some((c) => c.table === "notifications")).toBe(false);
  });
});
