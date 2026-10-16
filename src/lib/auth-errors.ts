const ARABIC = /[؀-ۿ]/;
// What fetch throws when the request never reached the server, per browser, plus supabase-js's
// AuthRetryableFetchError for the same case. PostgREST wraps it as "TypeError: Failed to fetch".
const NETWORK = /failed to fetch|networkerror|load failed|network request failed|fetch failed/i;

export const NETWORK_ERROR_AR = "تعذّر الاتصال — تحقّق من الإنترنت وحاول مرة أخرى";

/**
 * The Arabic text to show for any failed action. Our server functions and SQL functions already
 * raise Arabic messages, so those pass through; a network failure gets its own message, and any
 * other (English) library message is replaced by the screen's own `fallback`.
 */
export function userErrorMessage(err: unknown, fallback: string): string {
  const e = err as { message?: unknown; name?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  if (ARABIC.test(message)) return message;
  if (e?.name === "AuthRetryableFetchError" || NETWORK.test(message)) return NETWORK_ERROR_AR;
  return fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The sign-in forms use noValidate so the browser's English bubbles never show; this replaces
 * its email check. */
export function emailProblem(email: string): string | null {
  if (!email.trim()) return "أدخل بريدك الإلكتروني";
  if (!EMAIL_RE.test(email.trim())) return "البريد الإلكتروني غير صحيح";
  return null;
}

/** Same rules as userErrorMessage, for the sign-in, sign-up and password screens. */
export function authErrorMessage(err: unknown, fallback: string): string {
  return userErrorMessage(err, fallback);
}
