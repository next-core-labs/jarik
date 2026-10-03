import { createFileRoute, notFound } from "@tanstack/react-router";

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
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData ? `${loaderData.title} — جارك` : "صفحة قانونية — جارك" },
      { name: "description", content: loaderData?.title ?? "" },
    ],
  }),
  component: LegalPageRoute,
});

function LegalPageRoute() {
  const page = Route.useLoaderData();

  return (
    <main className="mx-auto max-w-2xl px-4 py-12" dir="rtl" lang="ar">
      <h1 className="font-display text-3xl font-bold">{page.title}</h1>
      <div className="mt-6 space-y-4 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">
        {page.body}
      </div>
    </main>
  );
}
