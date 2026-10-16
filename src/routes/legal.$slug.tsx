import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { tf } from "@/components/listing-detail/format";
import { SiteHeader } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";
import { langSearch, localeFromSearch, useLocale } from "@/lib/i18n";

type LegalPage = { slug: string; title: string; body: string };

async function loadLegalPage(slug: string): Promise<LegalPage> {
  const { data, error } = await supabase
    .from("legal_pages")
    .select("slug, title, body")
    .eq("slug", slug)
    .maybeSingle();
  if (error || !data) throw notFound();
  return data;
}

export const Route = createFileRoute("/legal/$slug")({
  staticData: { sitemap: false, publicLocale: true },
  loader: ({ params }) => loadLegalPage(params.slug),
  head: ({ loaderData, params, match }) => {
    const locale = localeFromSearch(match.search);
    // The legal text itself is Arabic only (legal_pages); the title is its own.
    const title = `${loaderData?.title ?? (locale === "en" ? "Legal" : "صفحة قانونية")} — ${tf(locale, "brand")}`;
    const description = loaderData
      ? tf(locale, "meta_legal_desc", { title: loaderData.title })
      : "";
    const url = `https://jarak-ksa.com/legal/${encodeURIComponent(params.slug)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
      ],
      links: [{ rel: "canonical", href: url }],
    };
  },
  component: LegalPageRoute,
});

function LegalPageRoute() {
  const page = Route.useLoaderData();
  const [locale] = useLocale();
  const en = locale === "en";

  return (
    <div dir={en ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <div className="mx-auto max-w-2xl px-5 pt-9 pb-16">
        <Link
          to="/"
          search={langSearch(locale)}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className="size-4 ltr:rotate-180" aria-hidden />
          {tf(locale, "back_market")}
        </Link>
        {en ? (
          <p className="mt-4 text-sm text-muted-foreground">{tf(locale, "legal_ar_only")}</p>
        ) : null}
        {/* The legal text is Arabic only, so it keeps its own direction in English mode too. */}
        <main dir="rtl" lang="ar">
          <h1 className="mt-5 font-display text-3xl font-bold">{page.title}</h1>
          <div className="mt-6 space-y-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
            {page.body}
          </div>
        </main>
      </div>
    </div>
  );
}
