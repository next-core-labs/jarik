import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Eye, Gift, Handshake, MessageCircle, PieChart, Phone } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { sar, shortDate } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/office-stats")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "إحصاءات المكتب — جارك" },
      {
        name: "description",
        content: "عدد المكاتب المسجّلة في الدليل، نسبة الإشغال، وتحويل الوحدات الشاغرة إلى صفقات.",
      },
      { property: "og:title", content: "إحصاءات المكتب — جارك" },
      { property: "og:description", content: "الإشغال والمكاتب المسجّلة وتحويل الشاغر إلى صفقات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OfficeStats,
});

const CONVERT_TAG = "تحويل وحدة شاغرة";

const typeRequest: Record<string, string> = {
  سكني: "إيجار شقة",
  تجاري: "إيجار محل",
  إداري: "إيجار مكتب",
};

function OfficeStats() {
  const queryClient = useQueryClient();

  const stats = useQuery({
    queryKey: ["office-stats"],
    queryFn: async () => {
      const [offices, units, deals] = await Promise.all([
        supabase.from("office_directory").select("id", { count: "exact", head: true }),
        supabase
          .from("units")
          .select(
            "id, unit_number, unit_name, unit_type, status, annual_rent, district, property_id, properties(name)",
          ),
        supabase.from("deals").select("id, client_name, stage, value, notes"),
      ]);
      if (units.error) throw units.error;
      return {
        officesCount: offices.count ?? 0,
        units: units.data ?? [],
        deals: deals.data ?? [],
      };
    },
  });

  const convert = useMutation({
    mutationFn: async (unit: {
      id: string;
      unit_number: string;
      unit_name: string | null;
      unit_type: string;
      annual_rent: number;
      property_id: string;
    }) => {
      const label = unit.unit_name || `وحدة ${unit.unit_number}`;
      const { error } = await supabase.from("deals").insert({
        client_name: `تسويق ${label}`,
        request_type: typeRequest[unit.unit_type] ?? "إيجار",
        // "lead" is the first column on /deals; a "new" stage is not rendered there at all.
        stage: "lead",
        value: Number(unit.annual_rent ?? 0),
        commission: Math.round(Number(unit.annual_rent ?? 0) * 0.025),
        property_id: unit.property_id,
        // The unit id is part of the note: unit numbers repeat across buildings, so matching on
        // the label alone marked same-numbered units in other buildings as already converted.
        notes: `${CONVERT_TAG}: ${label} [${unit.id}]`,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُضيفت الوحدة كصفقة تسويق جديدة");
      queryClient.invalidateQueries({ queryKey: ["office-stats"] });
      queryClient.invalidateQueries({ queryKey: ["deals", "with-vacant"] });
    },
    onError: () => toast.error("تعذّر التحويل — الصلاحية للموظفين فقط"),
  });

  const AD_PERFORMANCE_DAYS = 30;
  const adPerformance = useQuery({
    queryKey: ["listing-events", AD_PERFORMANCE_DAYS],
    queryFn: async () => {
      const since = new Date(Date.now() - AD_PERFORMANCE_DAYS * 86_400_000).toISOString();
      const { data, error } = await supabase
        .from("listing_events")
        .select("unit_id, event_type, units(unit_number, unit_name, properties(name))")
        .gte("created_at", since);
      if (error) throw error;
      const byUnit = new Map<
        string,
        { label: string; views: number; calls: number; whatsapp: number }
      >();
      for (const row of data ?? []) {
        const label = row.units
          ? `${row.units.properties?.name ?? ""} · ${row.units.unit_name || `وحدة ${row.units.unit_number}`}`
          : "وحدة محذوفة";
        const entry = byUnit.get(row.unit_id) ?? { label, views: 0, calls: 0, whatsapp: 0 };
        if (row.event_type === "view") entry.views++;
        else if (row.event_type === "call_click") entry.calls++;
        else if (row.event_type === "whatsapp_click") entry.whatsapp++;
        byUnit.set(row.unit_id, entry);
      }
      return [...byUnit.entries()]
        .map(([unitId, v]) => ({ unitId, ...v }))
        .sort((a, b) => b.views - a.views);
    },
  });

  const referrals = useQuery({
    queryKey: ["office-referrals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, referred_name, referred_phone, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const decideReferral = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "rewarded" | "declined" }) => {
      const { error } = await supabase.from("referrals").update({ status }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تحدّثت حالة الإحالة");
      queryClient.invalidateQueries({ queryKey: ["office-referrals"] });
    },
    onError: () => toast.error("تعذّر التحديث"),
  });

  const allUnits = stats.data?.units ?? [];
  const deals = stats.data?.deals ?? [];
  // A sold unit is out of the rental pool: not occupied, not vacant, and not a convert-to-deal
  // candidate (it was "converted" the moment it sold).
  const units = allUnits.filter((u) => u.status !== "sold");
  const total = units.length;
  const occupied = units.filter((u) => u.status === "occupied").length;
  const vacant = units.filter((u) => u.status === "vacant");
  const occupancy = total > 0 ? Math.round((occupied / total) * 100) : 0;
  const converted = deals.filter((d) => (d.notes ?? "").includes(CONVERT_TAG));
  const convertedIds = new Set<string>();
  const legacyLabels = new Set<string>(); // deals created before the unit id was stored in the note
  for (const d of converted) {
    const notes = d.notes ?? "";
    const id = notes.match(/\[([0-9a-f-]{36})\]/)?.[1];
    if (id) convertedIds.add(id);
    else legacyLabels.add(notes.split(": ")[1] ?? "");
  }
  const convertedWon = converted.filter((d) => d.stage === "won").length;

  if (stats.isLoading) return <Skeleton className="h-64" />;

  return (
    <>
      <PageHeader
        title="إحصاءات المكتب"
        subtitle="صورة سريعة: المكاتب المسجّلة في الدليل العام، نسبة إشغال وحداتك، وتحويل الشاغر إلى صفقات."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="shadow-deed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
              <Building2 className="size-4 text-brass" />
              مكاتب مسجّلة في الدليل
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold">{stats.data?.officesCount ?? 0}</p>
          </CardContent>
        </Card>
        <Card className="shadow-deed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
              <PieChart className="size-4 text-brass" />
              نسبة الإشغال
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold">{occupancy}%</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {occupied} مشغولة من {total} وحدة — {vacant.length} شاغرة
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-deed">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
              <Handshake className="size-4 text-brass" />
              وحدات شاغرة محوّلة لصفقات
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-3xl font-bold">{converted.length}</p>
            <p className="mt-1 text-xs text-muted-foreground">منها {convertedWon} صفقة مكتملة</p>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">الوحدات الشاغرة — حوّلها إلى صفقة تسويق</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {vacant.length === 0 ? (
            <p className="text-sm text-muted-foreground">كل الوحدات مشغولة حاليًا.</p>
          ) : (
            vacant.map((u) => {
              const label = u.unit_name || `وحدة ${u.unit_number}`;
              const done = convertedIds.has(u.id) || legacyLabels.has(label);
              return (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-4"
                >
                  <div>
                    <p className="font-medium">
                      {label}
                      <span className="ms-2 text-sm text-muted-foreground">
                        {u.properties?.name ?? ""} {u.district ? `— ${u.district}` : ""}
                      </span>
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {u.unit_type} — الإيجار السنوي {sar(Number(u.annual_rent ?? 0))}
                    </p>
                  </div>
                  {done ? (
                    <Badge variant="secondary">محوّلة لصفقة</Badge>
                  ) : (
                    <Button
                      size="sm"
                      disabled={convert.isPending}
                      onClick={() =>
                        convert.mutate({
                          id: u.id,
                          unit_number: u.unit_number,
                          unit_name: u.unit_name,
                          unit_type: u.unit_type,
                          annual_rent: Number(u.annual_rent ?? 0),
                          property_id: u.property_id,
                        })
                      }
                    >
                      حوّل إلى صفقة
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="text-base">
            أداء الإعلانات — آخر {AD_PERFORMANCE_DAYS} يومًا
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {adPerformance.isLoading ? (
            <Skeleton className="h-24" />
          ) : (adPerformance.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد مشاهدات مسجّلة بعد — تُحسب تلقائيًا من زيارات صفحات عروضك العامة.
            </p>
          ) : (
            adPerformance.data!.map((row) => (
              <div
                key={row.unitId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
              >
                <p className="font-medium">{row.label}</p>
                <div className="flex items-center gap-4 text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Eye className="size-4" aria-hidden />
                    {row.views}
                  </span>
                  <span className="flex items-center gap-1">
                    <Phone className="size-4" aria-hidden />
                    {row.calls}
                  </span>
                  <span className="flex items-center gap-1">
                    <MessageCircle className="size-4" aria-hidden />
                    {row.whatsapp}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Card className="mt-6 shadow-deed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Gift className="size-4 text-brass" aria-hidden />
            الإحالات
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {(referrals.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد إحالات بعد.</p>
          ) : (
            referrals.data!.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border p-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {r.referred_name}
                    {r.referred_phone ? ` · ${r.referred_phone}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{shortDate(r.created_at)}</p>
                </div>
                {r.status === "pending" ? (
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={decideReferral.isPending}
                      onClick={() => decideReferral.mutate({ id: r.id, status: "rewarded" })}
                    >
                      تحديد كمكافأة
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={decideReferral.isPending}
                      onClick={() => decideReferral.mutate({ id: r.id, status: "declined" })}
                    >
                      لم تكتمل
                    </Button>
                  </div>
                ) : (
                  <Badge variant={r.status === "rewarded" ? "default" : "outline"}>
                    {r.status === "rewarded" ? "تمت المكافأة" : "لم تكتمل"}
                  </Badge>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}
