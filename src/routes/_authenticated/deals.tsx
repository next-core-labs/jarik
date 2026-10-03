import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sar, shortDate, dealStageLabel } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/deals")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "المبيعات والصفقات — جارك" },
      { name: "description", content: "العملاء المحتملون ومراحل الصفقة والعمولات." },
      { property: "og:title", content: "المبيعات والصفقات — جارك" },
      { property: "og:description", content: "متابعة العملاء المحتملين والعمولات." },
    ],
  }),
  component: Deals,
});

const stages = ["lead", "contacted", "viewing", "negotiation", "won", "lost"] as const;

const typeKeywords: Record<string, string[]> = {
  شقة: ["شقة", "سكني"],
  فيلا: ["فيلا"],
  محل: ["محل", "تجاري"],
  مكتب: ["مكتب", "إداري"],
  عمارة: ["عمارة"],
  أرض: ["أرض"],
};

function suggestUnits(
  deal: { request_type: string; value: number },
  vacant: {
    id: string;
    unit_number: string;
    unit_type: string;
    annual_rent: number;
    district: string | null;
    properties: { name: string } | null;
  }[],
) {
  const words = typeKeywords[deal.request_type] ?? [];
  let matches = vacant.filter((u) => words.some((w) => u.unit_type.includes(w)));
  if (matches.length === 0) matches = vacant;
  if (Number(deal.value) > 0) {
    matches = matches.filter((u) => Number(u.annual_rent) <= Number(deal.value) * 1.2);
    if (matches.length === 0) return [];
  }
  return matches.slice(0, 3);
}

function Deals() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["deals", "with-vacant"],
    queryFn: async () => {
      const [deals, vacant] = await Promise.all([
        supabase
          .from("deals")
          .select(
            "id, client_name, phone, request_type, stage, value, commission, notes, created_at, assigned_to, properties(name)",
          )
          .order("created_at", { ascending: false }),
        supabase
          .from("units")
          .select("id, unit_number, unit_type, annual_rent, district, properties(name)")
          .eq("status", "vacant"),
      ]);
      if (deals.error) throw deals.error;
      return { deals: deals.data ?? [], vacant: vacant.data ?? [] };
    },
  });

  const claim = useMutation({
    mutationFn: async (id: string) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("deals")
        .update({ assigned_to: auth.user?.id ?? null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُسندت الصفقة لك");
      queryClient.invalidateQueries({ queryKey: ["deals", "with-vacant"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
    },
    onError: () => toast.error("تعذّر إسناد الصفقة"),
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="المبيعات والصفقات" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const dealsList = data.deals ?? [];
  const vacantList = data.vacant ?? [];

  const totalCommission = dealsList
    .filter((d) => d.stage === "won")
    .reduce((s, d) => s + Number(d.commission), 0);

  return (
    <>
      <PageHeader
        title="المبيعات والصفقات"
        subtitle="من العميل المحتمل حتى إتمام الصفقة واحتساب العمولة."
      />

      <Card className="mb-6 shadow-deed">
        <CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">عمولات الصفقات المكتملة</p>
          <p className="mt-2 font-display text-2xl font-bold">{sar(totalCommission)}</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {stages.map((stage) => {
          const items = dealsList.filter((d) => d.stage === stage);
          if (items.length === 0) return null;
          return (
            <Card key={stage} className="shadow-deed">
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="text-base">{dealStageLabel[stage]}</CardTitle>
                <Badge variant="outline">{items.length}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {items.map((d) => {
                  const suggestions =
                    d.stage === "won" || d.stage === "lost" ? [] : suggestUnits(d, vacantList);
                  return (
                    <div key={d.id} className="rounded-md border border-border bg-background p-4">
                      <p className="font-medium">{d.client_name}</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {d.request_type}
                        {d.properties?.name ? ` · ${d.properties.name}` : ""}
                      </p>
                      <p className="mt-2 text-sm">
                        القيمة {sar(d.value)} · العمولة {sar(d.commission)}
                      </p>
                      {d.phone ? (
                        <p
                          className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground"
                          dir="ltr"
                        >
                          <Phone className="size-3.5" />
                          {d.phone}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {shortDate(d.created_at)}
                      </p>
                      {d.assigned_to ? (
                        <p className="mt-1 text-xs text-brass">مُسندة لموظف</p>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          disabled={claim.isPending}
                          onClick={() => claim.mutate(d.id)}
                        >
                          إسنادها لي
                        </Button>
                      )}
                      {suggestions.length > 0 ? (
                        <div className="mt-3 rounded-md border border-dashed border-brass/50 bg-accent/40 p-3">
                          <p className="text-xs font-medium text-brass">
                            وحدات شاغرة تناسب هذا العميل:
                          </p>
                          <ul className="mt-1 space-y-1 text-xs">
                            {suggestions.map((u) => (
                              <li key={u.id}>
                                وحدة {u.unit_number} · {u.unit_type}
                                {u.district ? ` · ${u.district}` : ""} · {sar(u.annual_rent)} سنويًا
                                {u.properties?.name ? ` (${u.properties.name})` : ""}
                              </li>
                            ))}
                          </ul>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
      {dealsList.length === 0 ? (
        <p className="text-sm text-muted-foreground">لا توجد صفقات.</p>
      ) : null}
    </>
  );
}
