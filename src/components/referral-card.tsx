import { useQuery } from "@tanstack/react-query";
import { Copy, Gift } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { shortDate } from "@/lib/format";

const statusLabel: Record<string, string> = {
  pending: "قيد المتابعة",
  rewarded: "تمت مكافأتك",
  declined: "لم تكتمل",
};

/** رمز إحالة شخصي للمالك أو المستأجر، وحالة من أحالهم — بلا أتمتة مالية، المكافأة قرار المكتب. */
export function ReferralCard() {
  const code = useQuery({
    queryKey: ["my-referral-code"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_referral_code");
      if (error) throw error;
      return data;
    },
  });

  const referrals = useQuery({
    queryKey: ["my-referrals"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("referrals")
        .select("id, referred_name, status, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const copyCode = async () => {
    if (!code.data) return;
    try {
      await navigator.clipboard.writeText(code.data);
      toast.success("انسخ الرمز وشاركه");
    } catch {
      toast.error("تعذّر النسخ");
    }
  };

  return (
    <Card className="shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Gift className="size-4 text-brass" aria-hidden />
          أحِل صديقًا
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          شارك رمزك مع من تعرف — إذا كتبه بطلب وحدة جديد يصل مكتبك، تُسجَّل الإحالة باسمك.
        </p>
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-dashed border-border bg-muted/40 px-4 py-2 font-mono text-lg font-bold tracking-widest">
            {code.data ?? "…"}
          </span>
          <Button variant="outline" size="sm" onClick={copyCode} disabled={!code.data}>
            <Copy className="size-4" />
            نسخ
          </Button>
        </div>
        {(referrals.data ?? []).length > 0 ? (
          <div className="space-y-2 pt-2">
            {referrals.data!.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                <span>
                  {r.referred_name} · {shortDate(r.created_at)}
                </span>
                <Badge variant={r.status === "rewarded" ? "default" : "outline"}>
                  {statusLabel[r.status] ?? r.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
