import type { ServerCtx } from "@/lib/server-context";

/**
 * Throws `message` when the signed-in user has made more than `max` calls to `action` in the last
 * `windowSeconds` (counted by the `check_rate_limit` database function).
 *
 * If the limiter itself fails (for example the migration has not been applied yet) the call is
 * allowed and the problem is logged: an outage of the limiter must not take the feature down. The
 * limiter's own "exceeded" error is not an outage and blocks the call.
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
    // check_rate_limit RAISES once the limit is exceeded (it never returns false): that is a block,
    // not an outage. Treating every error as an outage let every limited call through.
    if (isLimitExceeded(error)) throw new Error(message);
    console.error(`[rate-limit] ${action}: limiter unavailable, allowing the call:`, error.message);
    return;
  }
  if (data === false) throw new Error(message);
}

/** The error check_rate_limit raises when the caller is over the limit (P0001, Arabic message). */
function isLimitExceeded(error: { message?: string; code?: string }): boolean {
  return /تجاوزت الحد/.test(error.message ?? "") || error.code === "54000";
}
