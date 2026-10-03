import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ScrollText } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { shortDate } from "@/lib/format";
import { PageHeader } from "@/components/app-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actionLabel, tableLabel, summarize, type AuditRow } from "@/lib/audit-format";

export const Route = createFileRoute("/_authenticated/audit")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "سجل التدقيق — جارك" },
      {
        name: "description",
        content: "سجل تلقائي لكل تغيير على الدفعات والعقود والوحدات والصيانة والمصروفات والصفقات.",
      },
      { property: "og:title", content: "سجل التدقيق — جارك" },
      { property: "og:description", content: "من غيّر ماذا ومتى — سجل كامل لكل عملية." },
    ],
  }),
  component: Audit,
});

function Audit() {
  const [table, setTable] = useState<string>("all");

  const { data, isLoading } = useQuery({
    queryKey: ["audit-log"],
    queryFn: async () => {
      const [log, profiles] = await Promise.all([
        supabase.from("audit_log").select("*").order("id", { ascending: false }).limit(300),
        supabase.from("profiles").select("id, full_name"),
      ]);
      if (log.error) throw log.error;
      const names = new Map<string, string>();
      for (const p of (profiles.data ?? []) as { id: string; full_name: string | null }[]) {
        if (p.full_name) names.set(p.id, p.full_name);
      }
      return { rows: (log.data ?? []) as unknown as AuditRow[], names };
    },
  });

  if (isLoading || !data) {
    return (
      <>
        <PageHeader title="سجل التدقيق" />
        <Skeleton className="h-64" />
      </>
    );
  }

  const rows = table === "all" ? data.rows : data.rows.filter((r) => r.table_name === table);

  return (
    <>
      <PageHeader
        title="سجل التدقيق"
        subtitle="كل تغيير يُسجّل تلقائيًا: من أجراه، على أي سجل، ومتى — لا يمكن التراجع عنه أو حذفه."
        action={
          <Select value={table} onValueChange={setTable}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل السجلات</SelectItem>
              {Object.entries(tableLabel).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card className="shadow-deed">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ScrollText className="size-4 text-brass" />
            آخر {rows.length} عملية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {rows.map((r) => (
            <div
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {actionLabel[r.action] ?? r.action} — {tableLabel[r.table_name] ?? r.table_name}
                  {r.summary ? ` · ${summarize(r.summary)}` : ""}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  بواسطة {(r.actor_id && data.names.get(r.actor_id)) || "النظام"} ·{" "}
                  {new Date(r.created_at).toLocaleString("ar-SA")}
                </p>
              </div>
              <Badge variant={r.action === "DELETE" ? "destructive" : "outline"}>
                {actionLabel[r.action] ?? r.action}
              </Badge>
            </div>
          ))}
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              لا توجد عمليات مسجلة {table !== "all" ? "على هذا النوع" : "بعد"}.
            </p>
          ) : null}
          <p className="pt-2 text-xs text-muted-foreground">
            يُعرض أحدث {shortDate(data.rows.at(-1)?.created_at ?? null) !== "—" ? "300" : ""} عملية
            من السجل الكامل.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
