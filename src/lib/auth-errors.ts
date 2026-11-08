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

/**
 * Same rules as userErrorMessage, for the sign-in, sign-up and password screens — plus Supabase
 * Auth's own English errors that the person can act on (a weak or leaked password, an expired link
 * session), which would otherwise all collapse into the screen's generic fallback.
 */
export function authErrorMessage(err: unknown, fallback: string): string {
  const e = err as { message?: unknown; code?: unknown; name?: unknown } | null;
  const message = typeof e?.message === "string" ? e.message : "";
  const code = typeof e?.code === "string" ? e.code : "";
  if (!ARABIC.test(message)) {
    if (
      code === "weak_password" ||
      e?.name === "AuthWeakPasswordError" ||
      /weak|pwned|should contain|at least/i.test(message)
    )
      return "كلمة المرور ضعيفة أو منتشرة — اختر كلمة أطول تجمع أحرفًا إنجليزية كبيرة وصغيرة وأرقامًا";
    if (code === "same_password" || /different from the old password/i.test(message))
      return "هذه كلمة مرورك الحالية نفسها — ادخل بها مباشرة";
    if (
      code === "session_not_found" ||
      code === "session_expired" ||
      code === "bad_jwt" ||
      e?.name === "AuthSessionMissingError" ||
      /session missing|jwt expired|unauthorized/i.test(message)
    )
      return "انتهت صلاحية رابط الدعوة أو الجلسة — افتح الرابط من البريد مرة أخرى أو اطلب دعوة جديدة";
  }
  return userErrorMessage(err, fallback);
}
