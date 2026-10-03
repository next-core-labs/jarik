import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

import { createFakeSupabase } from "./__testutils__/fakeSupabase";
import { resolvePublicOffice } from "./org.server";

type Admin = SupabaseClient<Database>;

const asAdmin = (fake: ReturnType<typeof createFakeSupabase>) => fake as unknown as Admin;
const orgSettingsCalls = (fake: ReturnType<typeof createFakeSupabase>) =>
  fake.calls.filter((c) => c.table === "org_settings" && c.method === "select");

describe("resolvePublicOffice", () => {
  it("delivers to the office being viewed when it is listed and verified", async () => {
    const fake = createFakeSupabase({
      org_settings: { data: { id: "office-b" }, error: null },
    });
    await expect(resolvePublicOffice(asAdmin(fake), "office-b")).resolves.toBe("office-b");
    // Only publicly listed AND verified offices can receive a public request.
    expect(fake.calls).toContainEqual({
      table: "org_settings",
      method: "eq",
      args: ["listed_publicly", true],
    });
    expect(fake.calls).toContainEqual({
      table: "org_settings",
      method: "eq",
      args: ["verified", true],
    });
  });

  it("never reroutes to another office when the chosen one is not listed or not verified", async () => {
    // The visitor is looking at office-b's listing; office-a exists and is verified, but the
    // request must not land with it.
    const fake = createFakeSupabase({
      org_settings: [
        { data: null, error: null },
        { data: [{ id: "office-a" }], error: null },
      ],
    });
    await expect(resolvePublicOffice(asAdmin(fake), "office-b")).resolves.toBeNull();
    expect(orgSettingsCalls(fake)).toHaveLength(1);
  });

  it("falls back to the oldest listed, verified office only when no office is named", async () => {
    const fake = createFakeSupabase({
      org_settings: { data: [{ id: "office-a" }], error: null },
    });
    await expect(resolvePublicOffice(asAdmin(fake))).resolves.toBe("office-a");
    expect(fake.calls).toContainEqual({
      table: "org_settings",
      method: "order",
      args: ["created_at", { ascending: true }],
    });
  });

  it("returns null when no office is listed and verified", async () => {
    const fake = createFakeSupabase({ org_settings: { data: [], error: null } });
    await expect(resolvePublicOffice(asAdmin(fake))).resolves.toBeNull();
  });
});
