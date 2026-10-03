import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Handshake, Inbox, Phone } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { createDealFromRequest } from "@/lib/office-tools.functions";
import { sar } from "@/lib/format";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/requests")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "طلبات الوحدات — جارك" },
      {
        name: "description",
        content: "طلبات الزوار على وحدات للإيجار، وتحويلها إلى صفقات تسويق بضغطة.",
      },
      { property: "og:title", content: "طلبات الوحدات — جارك" },
      { property: "og:description", content: "كل طلب وحدة يصل من الزوار في مكان واحد." },
    ],
  }),
  component: Requests,
});

type RequestRow = {
  id: string;
  full_name: string;
  phone: string;
  city: string | null;
  district: string | null;
  unit_type: string | null;
  budget: number | null;
  notes: string | null;
  status: string;
  created_at: string;
};

function Requests() {
  const queryClient = useQueryClient();
  const convert = useServerFn(createDealFromRequest);

  const { data, isLoading } = useQuery({
    queryKey: ["unit-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("unit_requests")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RequestRow[];
    },
  });

  const toDeal = useMutation({
    mutationFn: (id: string) => convert({ data: { requestId: id } }),
    onSuccess: () => {
      toast.success("تحوّل الطلب إلى صفقة في شاشة المبيعات");
      queryClient.invalidateQueries({ queryKey: ["unit-requests"] });
      queryClient.invalidateQueries({ queryKey: ["deals"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر التحويل"),
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="طلبات الوحدات" />
        <Skeleton className="h-64" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="طلبات الوحدات"
        subtitle="كل زائر يطلب وحدة من صفحة العرض يوصل طلبك هنا — حوّله إلى صفقة بضغطة."
      />

      <div className="space-y-3">
        {data.map((r) => (
          <Card key={r.id} className="shadow-deed">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-md bg-muted text-brass">
                    <Inbox className="size-5" />
                  </span>
                  <div>
                    <CardTitle className="text-base font-display">{r.full_name}</CardTitle>
                    <p className="mt-1 text-sm text-muted-foreground" dir="ltr">
                      {r.phone}
                    </p>
                  </div>
                </div>
                {/* "default" (red) is reserved for price/primary action/available — a converted
                    lead is none of those. */}
                <Badge variant={r.status === "converted" ? "outline" : "secondary"}>
                  {r.status === "converted" ? "تحوّلت صفقة" : "جديد"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {[
                  r.unit_type,
                  r.district ? `حي ${r.district}` : null,
                  r.city,
                  r.budget ? `الميزانية ${sar(r.budget)}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "بدون تفاصيل"}
              </p>
              {r.notes ? <p className="mt-2 text-sm">{r.notes}</p> : null}
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${r.phone}`}>
                    <Phone className="size-4" />
                    اتصال
                  </a>
                </Button>
                {r.status !== "converted" ? (
                  <Button size="sm" disabled={toDeal.isPending} onClick={() => toDeal.mutate(r.id)}>
                    <Handshake className="size-4" />
                    تحويل إلى صفقة
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>
        ))}
        {data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            لا توجد طلبات بعد — طلبات الزوار من صفحات العرض تظهر هنا تلقائيًا.
          </p>
        ) : null}
      </div>
    </>
  );
}
