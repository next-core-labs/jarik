import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "@lovable.dev/mcp-js";

import { createFakeSupabase } from "../../__testutils__/fakeSupabase";

let fakeSupabase: ReturnType<typeof createFakeSupabase>;

vi.mock("../supabase", () => ({
  supabaseForUser: () => fakeSupabase,
}));

afterEach(() => {
  vi.resetModules();
});

function fakeCtx(authenticated: boolean): ToolContext {
  return {
    isAuthenticated: () => authenticated,
    getToken: () => "token",
  } as unknown as ToolContext;
}

describe("portfolio_summary tool", () => {
  it("rejects unauthenticated callers before touching the database", async () => {
    fakeSupabase = createFakeSupabase();
    const { default: tool } = await import("./portfolio-summary");
    await expect(tool.handler({}, fakeCtx(false))).rejects.toThrow(
      "يجب تسجيل الدخول بحساب جارك لاستخدام هذه الأداة.",
    );
  });

  it("aggregates unit statuses and overdue payment totals for an authenticated caller", async () => {
    fakeSupabase = createFakeSupabase({
      properties: { data: null, error: null, count: 5 },
      units: {
        data: [{ status: "occupied" }, { status: "occupied" }, { status: "vacant" }],
        error: null,
      },
      leases: { data: null, error: null, count: 2 },
      payments: { data: [{ amount: 1500 }, { amount: 500 }], error: null },
      maintenance_requests: { data: null, error: null, count: 3 },
    });

    const { default: tool } = await import("./portfolio-summary");
    const result = (await tool.handler({}, fakeCtx(true))) as {
      structuredContent: {
        summary: {
          properties: number;
          units: number;
          unitsByStatus: Record<string, number>;
          activeLeases: number;
          overduePayments: number;
          overdueAmount: number;
          openMaintenance: number;
        };
      };
    };

    expect(result.structuredContent.summary).toEqual({
      properties: 5,
      units: 3,
      unitsByStatus: { occupied: 2, vacant: 1 },
      activeLeases: 2,
      overduePayments: 2,
      overdueAmount: 2000,
      openMaintenance: 3,
    });
  });

  it("throws a generic ToolError (not the raw DB error) when any underlying query fails", async () => {
    fakeSupabase = createFakeSupabase({
      properties: { data: null, error: null },
      units: { data: null, error: { message: "units query failed" } },
      leases: { data: null, error: null },
      payments: { data: null, error: null },
      maintenance_requests: { data: null, error: null },
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { default: tool } = await import("./portfolio-summary");
    await expect(tool.handler({}, fakeCtx(true))).rejects.toThrow(
      "تعذّر تنفيذ الطلب — تحقق من صلاحياتك أو البيانات المُرسَلة.",
    );
    // The raw DB error is still logged server-side, just not sent to the MCP caller.
    expect(errorSpy).toHaveBeenCalledWith("[mcp] query failed:", "units query failed");
    errorSpy.mockRestore();
  });
});
