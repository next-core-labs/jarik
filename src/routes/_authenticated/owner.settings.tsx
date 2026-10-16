import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";
import { userErrorMessage } from "@/lib/auth-errors";

import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { AccountProfileCard } from "@/components/account-profile-card";
import { PasswordField } from "@/components/password-field";
import { OfficeLinkRequest } from "@/components/office-link-request";
import { OwnerAutoApproveCard } from "@/components/owner-auto-approve-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/owner/settings")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "الإعدادات — جارك" },
      { name: "description", content: "تغيير كلمة مرور حسابك وربطه بمكتب في بوابة المالك." },
    ],
  }),
  component: OwnerSettings,
});

function OwnerSettings() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const changePassword = useMutation({
    mutationFn: async () => {
      if (password.length < 6) throw new Error("كلمة المرور 6 أحرف على الأقل");
      if (password !== confirm) throw new Error("كلمتا المرور غير متطابقتين");
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("تم تحديث كلمة المرور");
      setPassword("");
      setConfirm("");
    },
    onError: (e: Error) => toast.error(userErrorMessage(e, "تعذّر تحديث كلمة المرور")),
  });

  return (
    <>
      <PageHeader title="الإعدادات" subtitle="تغيير كلمة مرور حسابك وربطه بمكتب." />

      <div className="space-y-6">
        <AccountProfileCard />

        <OwnerAutoApproveCard />

        <Card className="max-w-md shadow-deed">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <KeyRound className="size-4 text-brass" />
              تغيير كلمة المرور
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <PasswordField
              id="new-password"
              label="كلمة المرور الجديدة"
              value={password}
              onChange={setPassword}
              minLength={6}
              autoComplete="new-password"
            />
            <PasswordField
              id="confirm-password"
              label="تأكيد كلمة المرور"
              value={confirm}
              onChange={setConfirm}
              minLength={6}
              autoComplete="new-password"
            />
            <Button
              disabled={changePassword.isPending || !password || !confirm}
              onClick={() => changePassword.mutate()}
            >
              {changePassword.isPending ? "جارٍ الحفظ..." : "حفظ كلمة المرور"}
            </Button>
          </CardContent>
        </Card>

        <OfficeLinkRequest kind="owner" />
      </div>
    </>
  );
}
