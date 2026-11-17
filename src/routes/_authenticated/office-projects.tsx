import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, ExternalLink, Globe, Images, Layers, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";

import { PageHeader } from "@/components/app-shell";
import { ProjectDialog } from "@/components/project-dialog";
import { ProjectModelsDialog } from "@/components/project-models-dialog";
import { ProjectPhotosDialog } from "@/components/project-photos-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { userErrorMessage } from "@/lib/auth-errors";
import { sar, shortDate } from "@/lib/format";
import { officeListingBlock } from "@/lib/listing-fee";
import { deliveryLabel, statusLabel, toProject, type ProjectStatus } from "@/lib/projects";
import { myOrgId } from "@/lib/use-org-branding";

export const Route = createFileRoute("/_authenticated/office-projects")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "المشاريع العقارية — جارك" },
      {
        name: "description",
        content: "إنشاء مشاريع البيع على الخارطة ونماذج وحداتها ونشرها في المنصة.",
      },
    ],
  }),
  component: OfficeProjects,
});

/** صف مشروع كما يقرؤه المكتب من جدوله (لا من العرض العام). */
type OwnProject = {
  id: string;
  name: string;
  developer_name: string | null;
  city: string | null;
  district: string | null;
  status: string;
  completion_pct: number;
  delivery_year: number | null;
  delivery_quarter: number | null;
  wafi_license_no: string | null;
  total_units: number | null;
  description: string | null;
  amenities: string[];
  lat: number | null;
  lng: number | null;
  published: boolean;
  published_at: string | null;
  featured: boolean;
  created_at: string;
  project_models: { id: string; price: number }[];
  project_photos: { id: string }[];
  project_interests: { id: string }[];
};

function OfficeProjects() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<OwnProject | null>(null);
  const [creating, setCreating] = useState(false);
  const [models, setModels] = useState<OwnProject | null>(null);
  const [photos, setPhotos] = useState<OwnProject | null>(null);

  const office = useQuery({
    queryKey: ["my-org-id-for-projects"],
    staleTime: 60_000,
    queryFn: () => myOrgId(),
  });

  // سبب عدم ظهور مشاريع المكتب للعموم (غير ظاهر في الدليل أو غير موثّق) — نفس بوابة العروض.
  const publishBlock = useQuery({
    queryKey: ["office-publish-block", office.data],
    enabled: Boolean(office.data),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("org_settings")
        .select("listed_publicly, verified")
        .eq("id", office.data!)
        .maybeSingle();
      if (error) throw error;
      return data ? officeListingBlock(data) : null;
    },
  });

  const projects = useQuery({
    queryKey: ["office-projects"],
    queryFn: async (): Promise<OwnProject[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select(
          "id, name, developer_name, city, district, status, completion_pct, delivery_year, delivery_quarter, wafi_license_no, total_units, description, amenities, lat, lng, published, published_at, featured, created_at, project_models(id, price), project_photos(id), project_interests(id)",
        )
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as OwnProject[];
    },
  });

  const publish = useMutation({
    mutationFn: async (input: { id: string; published: boolean }) => {
      const { error } = await supabase
        .from("projects")
        .update({ published: input.published })
        .eq("id", input.id);
      if (error) throw error;
      return input;
    },
    onSuccess: async (input) => {
      toast.success(input.published ? "نُشر المشروع في المنصة" : "أُخفي المشروع");
      await queryClient.invalidateQueries({ queryKey: ["office-projects"] });
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    // رسائل الحرس في القاعدة مكتوبة للمكتب (ترخيص وافي، نموذج واحد على الأقل…) فتُعرض كما هي.
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث نشر المشروع")),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: async () => {
      toast.success("حُذف المشروع");
      await queryClient.invalidateQueries({ queryKey: ["office-projects"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر حذف المشروع")),
  });

  const rows = projects.data ?? [];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="المشاريع العقارية"
        subtitle="مشاريع البيع على الخارطة وتحت الإنشاء: نماذج الوحدات، نسبة الإنجاز، وربع التسليم."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" />
            مشروع جديد
          </Button>
        }
      />

      {publishBlock.data ? (
        <p className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {publishBlock.data}{" "}
          <Link to="/settings" className="font-medium text-foreground underline underline-offset-4">
            الإعدادات
          </Link>
        </p>
      ) : null}

      {projects.isLoading ? (
        <Skeleton className="h-48" />
      ) : projects.error ? (
        <p className="text-sm text-destructive">تعذّر تحميل المشاريع.</p>
      ) : rows.length === 0 ? (
        <Card className="shadow-deed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Building2 className="size-10 text-muted-foreground opacity-50" aria-hidden />
            <p className="text-sm text-muted-foreground">
              لا مشاريع بعد. المشروع يختلف عن الوحدة: مجمّع أو برج له نماذج وحدات ونسبة إنجاز وربع
              تسليم، والمشتري يسجّل اهتمامًا بنموذج.
            </p>
            <Button onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              أنشئ أول مشروع
            </Button>
          </CardContent>
        </Card>
      ) : (
        rows.map((p) => {
          const prices = p.project_models.map((m) => Number(m.price)).filter((n) => n > 0);
          const from = prices.length > 0 ? Math.min(...prices) : 0;
          const interests = p.project_interests.length;
          const asProject = toProject({
            ...p,
            lat: p.lat,
            lng: p.lng,
            price_from: from,
            models_count: p.project_models.length,
            available_units: 0,
            cover_path: null,
            photos_count: 0,
            office_id: null,
            company_name: null,
            logo_url: null,
            fal_license_no: null,
            office_phone: null,
            whatsapp_number: null,
          });
          return (
            <Card key={p.id} className="shadow-deed">
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="text-base">{p.name}</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {[p.developer_name, p.city, p.district].filter(Boolean).join(" · ") ||
                        "بلا موقع"}{" "}
                      · أُنشئ {shortDate(p.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={p.published ? "default" : "outline"}>
                      {p.published ? "منشور" : "غير منشور"}
                    </Badge>
                    <Badge variant="outline">
                      {statusLabel(
                        (["off_plan", "under_construction", "ready"] as ProjectStatus[]).includes(
                          p.status as ProjectStatus,
                        )
                          ? (p.status as ProjectStatus)
                          : "off_plan",
                      )}
                    </Badge>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                  <span className="tabular-nums">
                    {p.project_models.length} نموذج
                    {from > 0 ? ` · يبدأ من ${sar(from)}` : " · بلا سعر"}
                  </span>
                  {p.status !== "ready" ? (
                    <span className="tabular-nums">الإنجاز {p.completion_pct}%</span>
                  ) : null}
                  {asProject && deliveryLabel(asProject) ? (
                    <span>التسليم {deliveryLabel(asProject)}</span>
                  ) : null}
                  {p.wafi_license_no ? (
                    <span dir="ltr" className="tabular-nums">
                      وافي {p.wafi_license_no}
                    </span>
                  ) : (
                    <span className="font-medium text-foreground">بلا ترخيص وافي</span>
                  )}
                  <span className="flex items-center gap-1 tabular-nums">
                    <Users className="size-3.5" aria-hidden />
                    {interests} اهتمام
                  </span>
                  {p.project_photos.length === 0 ? (
                    <span className="font-medium text-foreground">بلا صور</span>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(p)}>
                    تعديل المشروع
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setModels(p)}>
                    <Layers className="size-4" />
                    نماذج الوحدات ({p.project_models.length})
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPhotos(p)}>
                    <Images className="size-4" />
                    صور المشروع ({p.project_photos.length})
                  </Button>
                  <Button
                    size="sm"
                    variant={p.published ? "outline" : "default"}
                    disabled={publish.isPending}
                    onClick={() => publish.mutate({ id: p.id, published: !p.published })}
                  >
                    <Globe className="size-4" />
                    {p.published ? "إخفاء من المنصة" : "نشر في المنصة"}
                  </Button>
                  {p.published ? (
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/project/$projectId" params={{ projectId: p.id }} target="_blank">
                        <ExternalLink className="size-4" />
                        شاهد الصفحة
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `حذف «${p.name}» ونماذجه وصوره وتسجيلات الاهتمام به نهائيًا؟ لا رجعة في هذا.`,
                        )
                      ) {
                        remove.mutate(p.id);
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                    حذف
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      <ProjectDialog
        open={creating || editing !== null}
        project={editing}
        orgId={office.data ?? null}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
      />
      <ProjectModelsDialog
        open={models !== null}
        projectId={models?.id ?? null}
        projectName={models?.name ?? ""}
        onClose={() => setModels(null)}
      />
      <ProjectPhotosDialog
        open={photos !== null}
        projectId={photos?.id ?? null}
        projectName={photos?.name ?? ""}
        onClose={() => setPhotos(null)}
      />
    </div>
  );
}
