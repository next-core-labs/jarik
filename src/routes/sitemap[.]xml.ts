import { createFileRoute } from "@tanstack/react-router";
import { getRouterInstance } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import {
  sitemapRecordEntries,
  sitemapStaticPaths,
  sitemapXML,
  type SitemapEntry,
} from "@/lib/sitemap";

const BASE_URL = "https://jarak-ksa.com";
/** PostgREST returns at most 1000 rows per request; one sitemap file holds up to 50,000 URLs. */
const PAGE_SIZE = 1000;
const MAX_ROWS = 45_000;

/** Every id in a public view, a page at a time. Throws when a page can't be read. */
async function publicIds(view: "vacant_units_public" | "office_pages_public"): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(view)
      .select("id")
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    for (const row of data ?? []) if (row.id) ids.push(row.id);
    if ((data ?? []).length < PAGE_SIZE) break;
  }
  return ids;
}

export const Route = createFileRoute("/sitemap.xml")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      GET: async () => {
        const router = await getRouterInstance();
        const entries: SitemapEntry[] = sitemapStaticPaths(router).map((path) => ({ path }));
        // Listings and office pages come from the same public views their pages read. If they
        // can't be read, serve the static pages and let crawlers come back sooner.
        let complete = true;
        try {
          const [unitIds, officeIds] = await Promise.all([
            publicIds("vacant_units_public"),
            publicIds("office_pages_public"),
          ]);
          entries.push(...sitemapRecordEntries(unitIds, officeIds));
        } catch {
          complete = false;
        }
        if (entries.length === 0) {
          return new Response("No pages are included in this sitemap.", {
            status: 404,
            headers: { "Cache-Control": "no-store" },
          });
        }
        return new Response(sitemapXML(BASE_URL, entries), {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": complete ? "public, max-age=3600" : "public, max-age=300",
          },
        });
      },
    },
  },
});
