import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import {
  Bath,
  BedDouble,
  Building2,
  CalendarClock,
  Check,
  FileImage,
  MapPin,
  Ruler,
} from "lucide-react";

import { tf } from "@/components/listing-detail/format";
import { NearbyPlacesSection } from "@/components/nearby-places-section";
import { PhotoGallery } from "@/components/photo-gallery";
import { CompletionBar } from "@/components/project-card";
import { ProjectInterestForm } from "@/components/project-interest-form";
import { SiteHeader } from "@/components/site-header";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { publicNum, publicSar } from "@/lib/format";
import { langSearch, localeFromSearch, useLocale, type TranslationKey } from "@/lib/i18n";
import { phoneHref, whatsappHref } from "@/lib/market";
import {
  deliveryLabel,
  statusLabel,
  toProject,
  toProjectModel,
  type Project,
  type ProjectModel,
} from "@/lib/projects";
import { brandingUrl, mediaUrl } from "@/lib/unit-photos";
import { useTrackSiteVisit } from "@/lib/use-track-site-visit";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageData =
  | { status: "ok"; project: Project; models: ProjectModel[]; photos: string[] }
  | { status: "missing" };

async function loadProject(projectId: string): Promise<PageData> {
  if (!UUID_RE.test(projectId)) return { status: "missing" };
  const { data: row, error } = await supabase
    .from("projects_public")
    .select("*")
    .eq("id", projectId)
    .maybeSingle();
  if (error) return { status: "missing" };
  const project = row ? toProject(row) : null;
  if (!project) return { status: "missing" };

  const [modelsRes, photosRes] = await Promise.all([
    supabase
      .from("project_models_public")
      .select("*")
      .eq("project_id", projectId)
      .order("position"),
    supabase
      .from("project_photos_public")
      .select("path, position")
      .eq("project_id", projectId)
      .order("position"),
  ]);

  return {
    status: "ok",
    project,
    models: (modelsRes.data ?? []).map(toProjectModel).filter((m): m is ProjectModel => m !== null),
    photos: (photosRes.data ?? []).map((p) => p.path).filter((p): p is string => Boolean(p)),
  };
}

export const Route = createFileRoute("/project/$projectId")({
  staticData: { sitemap: false, publicLocale: true },
  loader: async ({ params }) => {
    const data = await loadProject(params.projectId);
    if (data.status === "missing") throw notFound();
    return data;
  },
  head: ({ loaderData, params, match }) => {
    const locale = localeFromSearch(match.search);
    if (loaderData?.status !== "ok") {
      return { meta: [{ name: "robots", content: "noindex" }] };
    }
    const { project: p, photos } = loaderData;
    const title = `${p.name} — ${locale === "en" ? "Jarak" : "جارك"}`;
    const facts = [
      statusLabel(p.status, locale),
      p.priceFrom > 0 ? `${tf(locale, "pj_price_from")} ${publicSar(p.priceFrom, locale)}` : null,
      [p.district, p.city].filter(Boolean).join(", ") || null,
      deliveryLabel(p, locale),
    ].filter(Boolean);
    const description = `${facts.join(" · ")}. ${p.office.name}.`;
    const image = photos[0] ?? p.coverPath;
    const url = `https://jarak-ksa.com/project/${encodeURIComponent(params.projectId)}`;
    return {
      meta: [
        { title },
        { name: "description", content: description },
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        { property: "og:type", content: "website" },
        { property: "og:url", content: url },
        ...(image ? [{ property: "og:image", content: mediaUrl(image) }] : []),
        { name: "twitter:card", content: image ? "summary_large_image" : "summary" },
      ],
      links: [{ rel: "canonical", href: url }],
      // نفس بيانات الصفحة المنشورة — قاعدة AGENTS.md.
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "ApartmentComplex",
            name: p.name,
            url,
            ...(p.description ? { description: p.description } : {}),
            ...(image ? { image: mediaUrl(image) } : {}),
            ...(p.totalUnits ? { numberOfAccommodationUnits: p.totalUnits } : {}),
            ...(p.city || p.district
              ? {
                  address: {
                    "@type": "PostalAddress",
                    ...(p.district ? { streetAddress: `حي ${p.district}` } : {}),
                    ...(p.city ? { addressLocality: p.city } : {}),
                    addressCountry: "SA",
                  },
                }
              : {}),
            ...(p.developerName
              ? { provider: { "@type": "Organization", name: p.developerName } }
              : {}),
            ...(p.wafiLicenseNo
              ? {
                  identifier: {
                    "@type": "PropertyValue",
                    name: "WAFI off-plan license",
                    value: p.wafiLicenseNo,
                  },
                }
              : {}),
            ...(p.priceFrom > 0
              ? {
                  makesOffer: {
                    "@type": "Offer",
                    price: p.priceFrom,
                    priceCurrency: "SAR",
                    availability: "https://schema.org/PreOrder",
                    url,
                  },
                }
              : {}),
          }),
        },
      ],
    };
  },
  component: ProjectPage,
});

function ProjectPage() {
  const data = Route.useLoaderData();
  const { project: p, models, photos } = data;
  useTrackSiteVisit(`/project/${p.id}`);
  const [locale] = useLocale();
  const t = (key: TranslationKey) => tf(locale, key);
  const search = langSearch(locale);
  const delivery = deliveryLabel(p, locale);
  const tel = phoneHref(p.office.phone);
  const wa = whatsappHref(p.office.whatsapp, `مرحبًا، أستفسر عن مشروع ${p.name}`);
  const logo = p.office.logoPath ? brandingUrl(p.office.logoPath) : null;

  return (
    <div dir={locale === "en" ? "ltr" : "rtl"} lang={locale} className="min-h-screen bg-background">
      <SiteHeader />
      <main className="mx-auto flex w-full max-w-[1240px] flex-col gap-7 px-5 pt-6 pb-16">
        <nav className="text-sm text-muted-foreground" aria-label="breadcrumb">
          <Link to="/projects" search={search} className="underline-offset-4 hover:underline">
            {t("pj_title")}
          </Link>{" "}
          / <span className="text-foreground">{p.name}</span>
        </nav>

        <PhotoGallery
          paths={photos}
          alt={p.name}
          locale={locale}
          badge={
            <span className="flex h-[30px] items-center bg-brass px-2.5 text-sm font-semibold text-brass-foreground">
              {statusLabel(p.status, locale)}
            </span>
          }
        />

        <div className="grid items-start gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-7">
            <section className="flex flex-col gap-2.5">
              <h1 className="text-[28px] leading-[1.35] font-bold text-pretty sm:text-[32px]">
                {p.name}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                {p.developerName ? (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="size-4 text-brass" aria-hidden />
                    {t("pj_developer")}: {p.developerName}
                  </span>
                ) : null}
                {p.city || p.district ? (
                  <span className="flex items-center gap-1.5">
                    <MapPin className="size-4 text-brass" aria-hidden />
                    {[p.district ? `حي ${p.district}` : null, p.city].filter(Boolean).join(" · ")}
                  </span>
                ) : null}
                {delivery ? (
                  <span className="flex items-center gap-1.5">
                    <CalendarClock className="size-4 text-brass" aria-hidden />
                    {t("pj_delivery")}: {delivery}
                  </span>
                ) : null}
              </div>

              {/* ترخيص «وافي» — شرط نظامي للبيع على الخارطة، فيُعرض كما يُعرض ترخيص الإعلان. */}
              {p.wafiLicenseNo ? (
                <p className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <Check className="size-4 text-brass" aria-hidden />
                  {t("pj_wafi_badge")}
                  <span dir="ltr" className="tabular-nums">
                    {p.wafiLicenseNo}
                  </span>
                </p>
              ) : null}

              {p.priceFrom > 0 ? (
                <p className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm text-muted-foreground">{t("pj_price_from")}</span>
                  <span className="text-[34px] leading-tight font-bold tabular-nums">
                    {publicSar(p.priceFrom, locale)}
                  </span>
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3 pt-1 sm:grid-cols-4">
                {p.status !== "ready" ? (
                  <CompletionBar
                    pct={p.completionPct}
                    label={t("pj_completion")}
                    className="col-span-2"
                  />
                ) : null}
                {p.totalUnits ? (
                  <Fact label={t("pj_total_units")} value={publicNum(p.totalUnits)} />
                ) : null}
                {p.availableUnits > 0 ? (
                  <Fact label={t("pj_available")} value={publicNum(p.availableUnits)} />
                ) : null}
              </div>
            </section>

            {p.description ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-xl font-bold">{t("pj_about")}</h2>
                <p className="text-[15px] leading-relaxed whitespace-pre-line text-muted-foreground">
                  {p.description}
                </p>
              </section>
            ) : null}

            {models.length > 0 ? (
              <section className="flex flex-col gap-3">
                <h2 className="text-xl font-bold">{t("pj_models")}</h2>
                <div className="overflow-x-auto rounded-xl border border-border bg-card">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-xs text-muted-foreground">
                        <th className="px-4 py-3 text-start font-medium">{t("pj_model")}</th>
                        <th className="px-4 py-3 text-start font-medium">{t("info_type")}</th>
                        <th className="px-4 py-3 text-start font-medium">{t("info_area")}</th>
                        <th className="px-4 py-3 text-start font-medium">{t("filter_rooms")}</th>
                        <th className="px-4 py-3 text-start font-medium">{t("pj_available")}</th>
                        <th className="px-4 py-3 text-start font-medium">
                          {t("filter_price_sale")}
                        </th>
                        <th className="px-4 py-3 text-start font-medium">{t("pj_plan")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {models.map((m) => (
                        <tr key={m.id}>
                          <td className="px-4 py-3 font-semibold">{m.name}</td>
                          <td className="px-4 py-3">{m.unitType}</td>
                          <td className="px-4 py-3 tabular-nums">
                            {m.area ? (
                              <span className="flex items-center gap-1">
                                <Ruler className="size-3.5 text-muted-foreground" aria-hidden />
                                {publicNum(m.area)} {t("unit_sqm")}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            <span className="flex items-center gap-2">
                              {m.rooms != null ? (
                                <span className="flex items-center gap-1">
                                  <BedDouble className="size-3.5" aria-hidden />
                                  {publicNum(m.rooms)}
                                </span>
                              ) : null}
                              {m.bathrooms != null ? (
                                <span className="flex items-center gap-1">
                                  <Bath className="size-3.5" aria-hidden />
                                  {publicNum(m.bathrooms)}
                                </span>
                              ) : null}
                              {m.rooms == null && m.bathrooms == null ? "—" : null}
                            </span>
                          </td>
                          <td className="px-4 py-3 tabular-nums">
                            {m.availableCount != null
                              ? `${publicNum(m.availableCount)}${m.unitsCount ? ` / ${publicNum(m.unitsCount)}` : ""}`
                              : "—"}
                          </td>
                          <td className="px-4 py-3 font-semibold tabular-nums">
                            {publicSar(m.price, locale)}
                          </td>
                          <td className="px-4 py-3">
                            {m.floorPlanPath ? (
                              <a
                                href={mediaUrl(m.floorPlanPath)}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-xs font-medium underline-offset-4 hover:underline"
                              >
                                <FileImage className="size-4 text-brass" aria-hidden />
                                {t("pj_plan_view")}
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            {p.amenities.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="text-xl font-bold">{t("pj_amenities")}</h2>
                <div className="flex flex-wrap gap-2">
                  {p.amenities.map((a) => (
                    <Badge key={a} variant="outline" className="text-xs font-medium">
                      {a}
                    </Badge>
                  ))}
                </div>
              </section>
            ) : null}

            {p.lat != null && p.lng != null ? (
              <NearbyPlacesSection lat={p.lat} lng={p.lng} locale={locale} />
            ) : null}
          </div>

          <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
            <ProjectInterestForm projectId={p.id} models={models} locale={locale} />

            <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-5">
              <div className="flex items-center gap-3">
                {logo ? (
                  <img
                    src={logo}
                    alt={p.office.name}
                    className="size-11 shrink-0 object-contain"
                    loading="lazy"
                  />
                ) : null}
                <div className="min-w-0">
                  <p className="truncate font-semibold">{p.office.name}</p>
                  {p.office.licenseNo ? (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {p.office.licenseNo}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {tel ? (
                  <a
                    href={tel}
                    className="flex h-10 flex-1 items-center justify-center bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                  >
                    {t("card_call")}
                  </a>
                ) : null}
                {wa ? (
                  <a
                    href={wa}
                    target="_blank"
                    rel="noreferrer"
                    className="flex h-10 flex-1 items-center justify-center bg-whatsapp px-3 text-sm font-semibold text-whatsapp-foreground transition-colors hover:bg-whatsapp/90"
                  >
                    {t("card_whatsapp")}
                  </a>
                ) : null}
              </div>
              {p.office.id ? (
                <Link
                  to="/office/$officeId"
                  params={{ officeId: p.office.id }}
                  search={search}
                  className="text-center text-sm font-medium underline-offset-4 hover:underline"
                >
                  {t("nav_offices")}
                </Link>
              ) : null}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-bold tabular-nums">{value}</span>
    </div>
  );
}
