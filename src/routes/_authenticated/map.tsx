import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { MapPin, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { geocodeProperties } from "@/lib/office-tools.functions";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

import type { MapProperty } from "@/components/units-map";

const UnitsMap = lazy(() => import("@/components/units-map"));

export const Route = createFileRoute("/_authenticated/map")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "خريطة الإشغال — جارك" },
      {
        name: "description",
        content: "خريطة تفاعلية لمواقع العقارات بألوان الإشغال: مشغول، فيه شاغر، بلا وحدات.",
      },
      { property: "og:title", content: "خريطة الإشغال — جارك" },
      { property: "og:description", content: "مواقع عقاراتك على الخريطة مع حالة الإشغال." },
    ],
  }),
  component: MapPage,
});

type Row = {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  lat: number | null;
  lng: number | null;
  units: { status: string; annual_rent: number }[] | null;
};

function MapPage() {
  const queryClient = useQueryClient();
  const geocode = useServerFn(geocodeProperties);

  const { data, isLoading } = useQuery({
    queryKey: ["map-properties"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, name, city, district, lat, lng, units(status, annual_rent)")
        .order("name");
      if (error) throw error;
      return (data ?? []) as unknown as Row[];
    },
  });

  const locate = useMutation({
    mutationFn: () => geocode(),
    onSuccess: (res) => {
      toast.success(
        res.updated > 0
          ? `حدّدنا موقع ${res.updated} عقار${res.remaining > 0 ? ` — تبقّى ${res.remaining} (اضغط مرة أخرى)` : ""}`
          : res.remaining > 0
            ? "لم نعرف مواقعها من العنوان — أضف اسم الحي أو المدينة في بيانات العقار"
            : "كل العقارات محددة الموقع",
      );
      queryClient.invalidateQueries({ queryKey: ["map-properties"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديد المواقع")),
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="خريطة الإشغال" />
        <Skeleton className="h-[520px]" />
      </>
    );
  }

  const mapped: MapProperty[] = data
    .filter((p) => p.lat != null && p.lng != null)
    .map((p) => {
      const units = p.units ?? [];
      const occupied = units.filter((u) => u.status === "occupied").length;
      return {
        name: p.name,
        city: p.city,
        district: p.district,
        lat: Number(p.lat),
        lng: Number(p.lng),
        unitsCount: units.length,
        occupied,
        vacant: units.filter((u) => u.status === "vacant").length,
        sold: units.filter((u) => u.status === "sold").length,
        rent: units
          .filter((u) => u.status === "occupied")
          .reduce((s, u) => s + Number(u.annual_rent ?? 0), 0),
      };
    });

  const withoutCoords = data.filter((p) => p.lat == null || p.lng == null).length;

  return (
    <>
      <PageHeader
        title="خريطة الإشغال"
        subtitle="مواقع العقارات على الخريطة — أخضر: مشغولة بالكامل، برتقالي: فيها وحدات شاغرة، رمادي: بلا وحدات."
        action={
          <Button
            onClick={() => locate.mutate()}
            disabled={locate.isPending || withoutCoords === 0}
          >
            <MapPin className="size-4" />
            {locate.isPending
              ? "جارٍ تحديد المواقع…"
              : withoutCoords > 0
                ? `تحديد مواقع ${withoutCoords} عقار تلقائيًا`
                : "كل المواقع محددة"}
          </Button>
        }
      />

      {mapped.length > 0 ? (
        <Card className="shadow-deed">
          <CardContent className="pt-6">
            <Suspense fallback={<Skeleton className="h-[520px]" />}>
              <UnitsMap properties={mapped} />
            </Suspense>
          </CardContent>
        </Card>
      ) : (
        <Card className="shadow-deed">
          <CardHeader>
            <CardTitle className="text-base">لا توجد مواقع محددة بعد</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              اضغط زر «تحديد المواقع تلقائيًا» وسيبحث النظام عن مواقع عقاراتك من اسمها وحيها
              ومدينتها.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#1F7A4D]" /> مشغولة بالكامل
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#9A6200]" /> فيها وحدات شاغرة
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-full bg-[#8E8986]" /> بلا وحدات
        </span>
        <span className="flex items-center gap-2">
          <RefreshCw className="size-3.5" /> اضغط أي عقار على الخريطة لتفاصيله
        </span>
      </div>
    </>
  );
}
