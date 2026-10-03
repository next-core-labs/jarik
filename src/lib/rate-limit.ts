import type { ServerCtx } from "@/lib/server-context";

/**
 * Throws `message` when the signed-in user has made more than `max` calls to `action` in the last
 * `windowSeconds` (counted by the `check_rate_limit` database function).
 *
 * If the limiter itself fails (for example the migration has not been applied yet) the call is
 * allowed and the problem is logged: an outage of the limiter must not take the feature down.
 */
export async function enforceRateLimit(
  ctx: ServerCtx,
  action: string,
  max: number,
  windowSeconds: number,
  message = "تجاوزت الحد المسموح من الطلبات — جرّب بعد قليل",
): Promise<void> {
  const { data, error } = await ctx.supabase.rpc("check_rate_limit", {
    _action: action,
    _max: max,
    _window_seconds: windowSeconds,
  });
  if (error) {
    console.error(`[rate-limit] ${action}: limiter unavailable, allowing the call:`, error.message);
    return;
  }
  if (data === false) throw new Error(message);
}
