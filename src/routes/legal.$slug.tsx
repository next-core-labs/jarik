import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

import { SiteHeader } from "@/components/site-header";
import { supabase } from "@/integrations/supabase/client";

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
  staticData: { sitemap: false },
  loader: ({ params }) => loadLegalPage(params.slug),
  head: ({ loaderData, params }) => {
    const title = loaderData ? `${loaderData.title} — جارك` : "صفحة قانونية — جارك";
    const description = loaderData ? `${loaderData.title} لمنصة جارك.` : "";
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

  return (
    <div className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-5 pt-9 pb-16" dir="rtl" lang="ar">
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowRight className="size-4" aria-hidden />
          العودة إلى سوق العروض
        </Link>
        <h1 className="mt-5 font-display text-3xl font-bold">{page.title}</h1>
        <div className="mt-6 space-y-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
          {page.body}
        </div>
      </main>
    </div>
  );
}
