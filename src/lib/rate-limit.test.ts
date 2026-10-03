import { describe, expect, it, vi } from "vitest";

import { enforceRateLimit } from "./rate-limit";
import type { ServerCtx } from "./server-context";

function ctxWithRpc(result: { data: boolean | null; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { ctx: { userId: "u1", supabase: { rpc } } as unknown as ServerCtx, rpc };
}

describe("enforceRateLimit", () => {
  it("passes the action, max and window to the database function", async () => {
    const { ctx, rpc } = ctxWithRpc({ data: true, error: null });
    await enforceRateLimit(ctx, "assistant", 30, 600);
    expect(rpc).toHaveBeenCalledWith("check_rate_limit", {
      _action: "assistant",
      _max: 30,
      _window_seconds: 600,
    });
  });

  it("allows the call while the user is within the limit", async () => {
    const { ctx } = ctxWithRpc({ data: true, error: null });
    await expect(enforceRateLimit(ctx, "a", 1, 60)).resolves.toBeUndefined();
  });

  it("throws the given message once the limit is exceeded", async () => {
    const { ctx } = ctxWithRpc({ data: false, error: null });
    await expect(enforceRateLimit(ctx, "a", 1, 60, "كثير")).rejects.toThrow("كثير");
    await expect(enforceRateLimit(ctx, "a", 1, 60)).rejects.toThrow(/تجاوزت الحد/);
  });

  it("fails open, and logs, when the limiter itself errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { ctx } = ctxWithRpc({ data: null, error: { message: "function does not exist" } });
    await expect(enforceRateLimit(ctx, "a", 1, 60)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
