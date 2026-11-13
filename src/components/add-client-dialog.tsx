import { useEffect, useId, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { userErrorMessage } from "@/lib/auth-errors";
import { emailOfficeInvitation } from "@/lib/office-invitations.functions";
import { digitsOnly } from "@/lib/saudi-id";

type Kind = "owner" | "tenant";
const KIND_LABEL: Record<Kind, string> = { owner: "مالك", tenant: "مستأجر" };

/**
 * «إضافة مالك» / «إضافة مستأجر»: an existing Jarak account by its 6-digit «الرقم التعريفي» —
 * linked right away and notified (office_add_client_by_code) — or anyone by email, as an
 * invitation they accept (office_link_client + the invitation email).
 */
export function AddClientDialog({
  kind,
  open,
  onOpenChange,
}: {
  kind: Kind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"code" | "email">("code");
  const [codeText, setCodeText] = useState("");
  const [email, setEmail] = useState("");
  const emailInvitation = useServerFn(emailOfficeInvitation);

  useEffect(() => {
    if (!open) return;
    setMode("code");
    setCodeText("");
    setEmail("");
  }, [open]);

  const code = digitsOnly(codeText);
  const account = useQuery({
    queryKey: ["account-by-code", code],
    enabled: open && mode === "code" && code.length === 6,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("lookup_account_by_code", { _code: code });
      if (error) throw error;
      const row = data?.[0];
      if (!row) throw new Error("لا يوجد حساب بهذا الرقم التعريفي");
      return row;
    },
  });
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["client-accounts"] });
    queryClient.invalidateQueries({ queryKey: ["office-tenants"] });
    queryClient.invalidateQueries({ queryKey: ["office-people"] });
    queryClient.invalidateQueries({ queryKey: ["office-invitations"] });
    queryClient.invalidateQueries({ queryKey: ["new-lease-options"] });
  };

  const add = useMutation({
    mutationFn: async (): Promise<string> => {
      if (mode === "code") {
        const { data, error } = await supabase.rpc("office_add_client_by_code", {
          _code: code,
          _kind: kind,
        });
        if (error) throw error;
        // An unknown number returns nothing (so the attempt still counts against the limit).
        if (!data) throw new Error("لا يوجد حساب بهذا الرقم التعريفي");
        return `أُضيف ${data} ${KIND_LABEL[kind]}ًا لمكتبك ووصله إشعار`;
      }
      const { error } = await supabase.rpc("office_link_client", {
        _email: email.trim(),
        _kind: kind,
      });
      if (error) throw error;
      try {
        await emailInvitation({ data: { email: email.trim() } });
        return "أُرسلت الدعوة إلى بريده — يرتبط بمكتبك بعد قبولها";
      } catch {
        return "حُفظت الدعوة وتظهر له عند دخوله — تعذّر إرسال البريد الآن";
      }
    },
    onSuccess: (message) => {
      toast.success(message);
      refresh();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّرت الإضافة")),
  });

  const ready = mode === "code" ? Boolean(account.data) : validEmail;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">إضافة {KIND_LABEL[kind]}</DialogTitle>
          <DialogDescription>
            {kind === "owner"
              ? "بعد إضافته تستطيع إسناد الوحدات إليه وبناء صفحته العامة."
              : "بعد إضافته يظهر في «مستأجر مسجّل» عند إنشاء عقد جديد."}
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mode === "code" ? "secondary" : "outline"}
            aria-pressed={mode === "code"}
            onClick={() => setMode("code")}
          >
            برقم التعريف
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "email" ? "secondary" : "outline"}
            aria-pressed={mode === "email"}
            onClick={() => setMode("email")}
          >
            بالبريد الإلكتروني
          </Button>
        </div>

        {mode === "code" ? (
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-code`}>الرقم التعريفي</Label>
            <Input
              id={`${uid}-code`}
              dir="ltr"
              inputMode="numeric"
              value={codeText}
              onChange={(e) => setCodeText(e.target.value)}
              placeholder="6 أرقام"
            />
            {account.data ? (
              <p className="rounded-sm border border-border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">{account.data.full_name}</span>
                {account.data.phone_hint ? (
                  <span className="text-muted-foreground">
                    {" · جوال ينتهي بـ "}
                    <span dir="ltr">{account.data.phone_hint.replace(/^•+/, "")}</span>
                  </span>
                ) : null}
                {account.data.already_client ? (
                  <span className="block text-xs text-muted-foreground">مرتبط بمكتبك من قبل.</span>
                ) : (
                  <span className="block text-xs text-muted-foreground">
                    يُربط بمكتبك فورًا ويصله إشعار.
                  </span>
                )}
              </p>
            ) : account.isError ? (
              <p className="text-xs text-destructive">
                {userErrorMessage(account.error, "تعذّر التحقق من الرقم التعريفي")}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                يجده صاحب الحساب في «حسابي» على جارك — اطلبه منه.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor={`${uid}-email`}>البريد الإلكتروني</Label>
            <Input
              id={`${uid}-email`}
              type="email"
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-invalid={Boolean(email.trim()) && !validEmail}
            />
            {email.trim() && !validEmail ? (
              <p className="text-xs text-destructive">
                البريد الإلكتروني غير صحيح — مثال: name@example.com
              </p>
            ) : null}
            <p className="text-xs text-muted-foreground">
              تصله دعوة يقبلها من حسابه (وإن لم يكن له حساب يُنشئه من الرابط). إرسال الدعوات بالبريد
              لمدير المكتب.
            </p>
          </div>
        )}

        {kind === "tenant" ? (
          <p className="text-xs text-muted-foreground">
            مستأجر بلا حساب على جارك؟ أضفه مع عقده من{" "}
            <Link to="/tenants" className="underline underline-offset-4">
              المستأجرون والعقود ← عقد جديد
            </Link>
            .
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            إلغاء
          </Button>
          <Button onClick={() => add.mutate()} disabled={!ready || add.isPending}>
            {add.isPending ? "جارٍ الإضافة…" : `إضافة ${KIND_LABEL[kind]}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
