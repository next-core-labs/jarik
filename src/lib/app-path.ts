/**
 * A pathname the way the router matches it: case-insensitively and with or without a trailing
 * slash, so `/HQ`, `/Hq/` and `/hq` all open the same page. Every check of which page is open (the
 * `_authenticated` route gate, the app shell's nav) compares this form, never the raw pathname,
 * or `/HQ` renders the /hq page while the gate and the shell take it for some other path.
 */
export function appPath(pathname: string): string {
  return pathname.toLowerCase().replace(/\/+$/, "") || "/";
}
