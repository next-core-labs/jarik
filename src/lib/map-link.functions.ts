import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isShortMapLink, parseLocation, type LatLng } from "@/lib/location-input";
import { enforceRateLimit } from "@/lib/rate-limit";

/** Hosts a Google Maps share link may redirect through — anything else is never fetched. */
const GOOGLE_HOST = /^(?:maps\.app\.goo\.gl|goo\.gl|g\.co|(?:www\.|maps\.)?google\.com(?:\.sa)?)$/i;
const MAX_HOPS = 5;

/**
 * Opens a short Google Maps share link (maps.app.goo.gl/…) on the server and reads the coordinates
 * from the address it redirects to. Only Google hosts are followed; the page body is never parsed
 * (its map centre is the requester's location, not the place).
 */
export const resolveMapLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ url: z.string().trim().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }): Promise<LatLng | null> => {
    if (!isShortMapLink(data.url)) return parseLocation(data.url);
    await enforceRateLimit(context, "resolve_map_link", 30, 600);

    let url = /^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return null;
      }
      if (parsed.protocol !== "https:" || !GOOGLE_HOST.test(parsed.hostname)) return null;
      const found = parseLocation(url);
      if (found) return found;

      const res = await fetch(url, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; JarakBot/1.0)" },
        signal: AbortSignal.timeout(6000),
      }).catch(() => null);
      if (!res) return null;
      const next = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (res.status < 300 || res.status >= 400 || !next) return null;
      url = new URL(next, url).toString();
    }
    return parseLocation(url);
  });
