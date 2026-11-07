import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { userErrorMessage } from "@/lib/auth-errors";
import { arNum, sar, shortDate } from "@/lib/format";

/**
 * Staff: owners' open requests to change a vacant unit's asking rent (owner_rent_requests, RLS
 * scopes it to the caller's office). Setting the unit's rent to the requested amount answers a
 * request on its own; here the office marks one handled or declines it, with an optional reply the
 * owner sees on their dashboard. Renders nothing when there is no open request.
 */
export function OwnerRentRequests() {
  const queryClient = useQueryClient();
  const [replies, setReplies] = useState<Record<string, string>>({});

  const { data } = useQuery({
    queryKey: ["owner-rent-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owner_rent_requests")
        .select(
          "id, current_rent, requested_rent, note, created_at, units(unit_number, properties(name))",
        )
        .eq("status", "open")
        .order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: "handled" | "declined" }) => {
      const reply = replies[id]?.trim();
      const { error } = await supabase.rpc("staff_resolve_rent_request", {
        _request_id: id,
        _status: status,
        ...(reply ? { _reply: reply } : {}),
      });
      if (error) throw error;
      return status;
    },
    onSuccess: (status) => {
      toast.success(status === "handled" ? "أبلغنا المالك بمعالجة طلبه" : "أبلغنا المالك باعتذارك");
      queryClient.invalidateQueries({ queryKey: ["owner-rent-requests"] });
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث الطلب")),
  });

  if (!data || data.length === 0) return null;

  return (
    <Card className="shadow-deed">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">طلبات الملاك لتعديل الإيجار</CardTitle>
        <Badge variant="outline">{arNum(data.length)}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {data.map((r) => (
          <div key={r.id} className="rounded-md border border-border bg-background p-4 text-sm">
            <p className="font-medium">
              {r.units?.properties?.name} · وحدة {r.units?.unit_number}
            </p>
            <p className="mt-1 text-muted-foreground">
              من {sar(r.current_rent)} إلى{" "}
              <span className="font-semibold text-foreground">{sar(r.requested_rent)}</span> سنويًا
              · {shortDate(r.created_at)}
            </p>
            {r.note ? <p className="mt-1 text-muted-foreground">ملاحظة المالك: {r.note}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">
              يُعالَج الطلب تلقائيًا عند تعديل إيجار الوحدة إلى المبلغ المطلوب.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                aria-label="رد للمالك (اختياري)"
                placeholder="رد للمالك (اختياري)"
                maxLength={400}
                className="h-8 min-w-48 flex-1 text-xs"
                value={replies[r.id] ?? ""}
                onChange={(e) => setReplies((prev) => ({ ...prev, [r.id]: e.target.value }))}
              />
              <Button
                size="sm"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: r.id, status: "handled" })}
              >
                تمت المعالجة
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={resolve.isPending}
                onClick={() => resolve.mutate({ id: r.id, status: "declined" })}
              >
                اعتذار
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
