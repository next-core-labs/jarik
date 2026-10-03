/** True if the string has a backslash or an ASCII control character. */
function hasBackslashOrControl(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code === 0x5c || code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}

/**
 * Only same-origin relative paths are accepted as a post-login destination.
 *
 * Rejects protocol-relative ("//host"), backslash variants ("/\host" — browsers treat "\" as "/"),
 * control characters (browsers strip tabs/newlines, so "/<TAB>/host" becomes "//host"), and
 * anything that does not resolve back to the same origin.
 */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (hasBackslashOrControl(value)) return null;
  try {
    const base = "https://same-origin.invalid";
    if (new URL(value, base).origin !== base) return null;
  } catch {
    return null;
  }
  return value;
}
