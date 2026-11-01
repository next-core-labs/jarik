/** Only Moyasar's own pages are ever opened as a payment link. */
export function isMoyasarCheckoutUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return url.startsWith("https://") && (host === "moyasar.com" || host.endsWith(".moyasar.com"));
  } catch {
    return false;
  }
}
