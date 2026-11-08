import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { JarakSymbol } from "@/components/jarak-logo";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";
import { resolvePostLoginPath } from "@/lib/portal-routing";
import type { AppRole } from "@/lib/use-role";

export const Route = createFileRoute("/reset-password")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "كلمة مرور جديدة — جارك" }, { name: "robots", content: "noindex" }],
  }),
  component: ResetPassword,
});

/**
 * Where a password-reset LINK lands (resetPasswordForEmail's redirectTo). The sign-in screens ask
 * for the 6-digit code our own email carries; when the email arrives as a link instead (Supabase's
 * default template), the link opens a recovery session here and the person picks a new password.
 */
function ResetPassword() {
  const navigate = useNavigate();
  // null while the link's session is read, so the "expired" note doesn't flash.
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let settled = false;
    const settle = (ok: boolean) => {
      if (settled) return;
      settled = true;
      setReady(ok);
    };
    // The session from the link's #access_token is set during client start-up, which can finish
    // after this effect: listen for it too, and give up after a few seconds.
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN")) settle(true);
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) settle(true);
    });
    const timer = setTimeout(() => settle(false), 4000);
    return () => {
      sub.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("كلمة المرور 6 أحرف على الأقل");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error && error.code !== "same_password") throw error;
      const { data: userData } = await supabase.auth.getUser();
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user?.id ?? "");
      toast.success("تم تغيير كلمة المرور");
      navigate({
        to: resolvePostLoginPath((roleRows ?? []).map((r) => r.role as AppRole)),
        replace: true,
      });
    } catch (err) {
      toast.error(authErrorMessage(err, "تعذّر تغيير كلمة المرور — حاول مرة أخرى"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <JarakSymbol className="mx-auto size-12" />
        <h1 className="font-display mt-4 text-center text-2xl font-bold">كلمة مرور جديدة</h1>

        {ready === null ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">جارٍ التحقق من الرابط…</p>
        ) : !ready ? (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              هذا الرابط انتهى أو استُخدم من قبل — اطلب رابطًا جديدًا من صفحة الدخول.
            </p>
            <Button asChild className="w-full">
              <Link to="/auth">صفحة الدخول</Link>
            </Button>
          </div>
        ) : (
          <form onSubmit={save} noValidate className="mt-6 space-y-4">
            <PasswordField
              id="new-password"
              label="كلمة المرور الجديدة"
              value={password}
              onChange={setPassword}
              minLength={6}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">6 أحرف على الأقل.</p>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
