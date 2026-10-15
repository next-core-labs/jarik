import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { sar } from "@/lib/format";
import { toLatinDigits } from "@/lib/saudi-id";

const MAX_LIMIT = 1_000_000;

/**
 * The owner's maintenance auto-approve limit. Enforced in the database (zz_owner_auto_approve on
 * maintenance_requests): a request awaiting approval at or under the limit is approved on the
 * owner's behalf, and the owner is notified.
 */
export function OwnerAutoApproveCard() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ["owner-preferences"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("owner_preferences")
        .select("auto_approve_limit")
        .maybeSingle();
      if (error) throw error;
      return data?.auto_approve_limit == null ? null : Number(data.auto_approve_limit);
    },
  });

  const [enabled, setEnabled] = useState(false);
  const [limit, setLimit] = useState("");
  useEffect(() => {
    if (prefs.data === undefined) return;
    setEnabled(prefs.data !== null);
    setLimit(prefs.data !== null ? String(prefs.data) : "500");
  }, [prefs.data]);

  const value = Number(limit);
  const valid = !enabled || (Number.isFinite(value) && value > 0 && value <= MAX_LIMIT);

  const save = useMutation({
    mutationFn: async () => {
      const { data: session } = await supabase.auth.getSession();
      const uid = session.session?.user.id;
      if (!uid) throw new Error("انتهت الجلسة — سجّل الدخول من جديد");
      const { error } = await supabase.from("owner_preferences").upsert({
        owner_id: uid,
        auto_approve_limit: enabled ? Math.round(value) : null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        enabled
          ? `سنوافق نيابةً عنك على الصيانة حتى ${sar(Math.round(value))}`
          : "أوقفت الموافقة التلقائية — كل صيانة فوق حد المكتب ستنتظر موافقتك",
      );
      queryClient.invalidateQueries({ queryKey: ["owner-preferences"] });
      queryClient.invalidateQueries({ queryKey: ["owner-dashboard"] });
    },
    onError: (e: Error) => toast.error(e.message || "تعذّر حفظ الإعداد"),
  });

  const dirty =
    prefs.data !== undefined &&
    (enabled !== (prefs.data !== null) || (enabled && Math.round(value) !== prefs.data));

  return (
    <Card id="auto-approve" className="max-w-md scroll-mt-6 shadow-deed">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <BadgeCheck className="size-4 text-brass" />
          الموافقة التلقائية على الصيانة
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          الصيانة التي تتجاوز حد المكتب تنتظر موافقتك. فعّل هذا لتُعتمد الطلبات الصغيرة فورًا دون
          انتظارك — وتصلك بها إشعار.
        </p>
        {prefs.isError ? (
          <p className="text-sm text-destructive">تعذّر تحميل الإعداد. أعد تحميل الصفحة.</p>
        ) : (
          <>
            <label className="flex items-center justify-between gap-3 text-sm font-medium">
              وافق تلقائيًا نيابةً عني
              <Switch checked={enabled} onCheckedChange={setEnabled} disabled={prefs.isLoading} />
            </label>
            {enabled ? (
              <div className="space-y-2">
                <label htmlFor="auto-approve-limit" className="text-sm text-muted-foreground">
                  حتى تكلفة (ر.س)
                </label>
                <Input
                  id="auto-approve-limit"
                  inputMode="numeric"
                  dir="ltr"
                  value={limit}
                  onChange={(e) => setLimit(toLatinDigits(e.target.value).replace(/\D/g, ""))}
                />
                <p className="text-xs text-muted-foreground">
                  {valid && value > 0
                    ? `أي صيانة بتكلفة ${sar(Math.round(value))} أو أقل تُعتمد فورًا.`
                    : "أدخل مبلغًا أكبر من صفر."}
                </p>
              </div>
            ) : null}
            <Button disabled={!valid || !dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? "جارٍ الحفظ..." : "حفظ"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
