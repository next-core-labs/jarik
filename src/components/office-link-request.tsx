import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { shortDate } from "@/lib/format";

const statusLabel: Record<string, string> = {
  pending: "بانتظار المكتب",
  accepted: "تم الربط",
  declined: "رفضها المكتب",
  cancelled: "ألغيتها",
};

/**
 * ربط ذاتي بمكتب عبر رمزه — عكس اتجاه "ربط مالك أو مستأجر" الموجودة بفريق المكتب (هناك المكتب
 * يدعو بالإيميل؛ هنا الحساب يطلب بالرمز والمكتب يوافق). يُستخدم من /tenant/settings و/owner/settings
 * بنفس الشكل بالضبط، يفرّقهم بس kind.
 */
export function OfficeLinkRequest({ kind }: { kind: "owner" | "tenant" }) {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");

  const requests = useQuery({
    queryKey: ["my-link-requests"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_link_requests");
      if (error) throw error;
      return data ?? [];
    },
  });

  const send = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.rpc("request_office_link", {
        _office_code: code.trim(),
        _kind: kind,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُرسل طلب الربط — بانتظار موافقة المكتب");
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["my-link-requests"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر إرسال الطلب"),
  });

  const cancel = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("cancel_link_request", { _id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("أُلغي الطلب");
      queryClient.invalidateQueries({ queryKey: ["my-link-requests"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر الإلغاء"),
  });

  const rows = requests.data ?? [];

  return (
    <Card className="max-w-md shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Link2 className="size-4 text-brass" />
          اربط حسابك بمكتب
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input
            className="max-w-40"
            dir="ltr"
            placeholder="رمز المكتب"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button disabled={send.isPending || code.trim().length < 3} onClick={() => send.mutate()}>
            {send.isPending ? "جارٍ الإرسال..." : "أرسل طلب الربط"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          اطلب رمز المكتب من موظفيه، ثم أدخله هنا. يوصل طلبك للمكتب ويرتبط حسابك به بعد موافقته.
        </p>

        {rows.length > 0 ? (
          <div className="space-y-2 border-t border-border pt-3">
            {rows.map((r) => (
              <div
                key={r.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <span>
                  {r.office_name} · {shortDate(r.created_at)}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={r.status === "accepted" ? "secondary" : "outline"}>
                    {statusLabel[r.status] ?? r.status}
                  </Badge>
                  {r.status === "pending" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={cancel.isPending}
                      onClick={() => cancel.mutate(r.id)}
                    >
                      إلغاء
                    </Button>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
