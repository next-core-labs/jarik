import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { JarakSymbol } from "@/components/jarak-logo";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { authErrorMessage } from "@/lib/auth-errors";
import { resolvePostLoginPath } from "@/lib/portal-routing";
import { completeTenantActivation } from "@/lib/tenant-portal.functions";
import type { AppRole } from "@/lib/use-role";

export const Route = createFileRoute("/tenant/activate")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "تفعيل حساب المستأجر — جارك" }, { name: "robots", content: "noindex" }],
  }),
  component: ActivateTenant,
});

/**
 * الوجهة بعد الضغط على رابط دعوة Supabase (inviteUserByEmail): يفتح الرابط جلسة تلقائيًا (نفس
 * آلية رابط استرجاع كلمة المرور)، وهذه الصفحة تطلب من المستأجر تعيين كلمة مرور لأول مرة، ثم تربط
 * حسابه بسجل tenants الخاص بعقده عبر completeTenantActivation.
 */
function ActivateTenant() {
  const navigate = useNavigate();
  // null while the invite link's session is still being read, so the "expired" note doesn't flash.
  const [ready, setReady] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error("كلمة المرور 6 أحرف على الأقل");
      return;
    }
    setLoading(true);
    try {
      const { error: pwError } = await supabase.auth.updateUser({ password });
      if (pwError) throw pwError;

      await completeTenantActivation();

      const { data: userData } = await supabase.auth.getUser();
      const { data: roleRows } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userData.user?.id ?? "");
      const roles = (roleRows ?? []).map((r) => r.role as AppRole);

      toast.success("تفعّل حسابك — أهلًا بك");
      navigate({ to: resolvePostLoginPath(roles), replace: true });
    } catch (err) {
      toast.error(authErrorMessage(err, "تعذّر تفعيل الحساب — حاول مرة أخرى"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <JarakSymbol className="mx-auto size-12" />
        <h1 className="font-display mt-4 text-center text-2xl font-bold">تفعيل حسابك</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          دعاك مكتبك العقاري — عيّن كلمة مرور لإكمال حسابك.
        </p>

        {ready === null ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">جارٍ التحقق من الرابط…</p>
        ) : !ready ? (
          <div className="mt-6 space-y-4 text-center">
            <p className="text-sm text-muted-foreground">
              هذا الرابط انتهى أو غير صحيح — اطلب من المكتب دعوة جديدة. وإن كنت فعّلت حسابك من قبل
              فادخل بكلمة مرورك.
            </p>
            <Button asChild className="w-full">
              <Link to="/tenant/login">دخول المستأجر</Link>
            </Button>
            <Link
              to="/"
              className="inline-block text-sm text-muted-foreground hover:text-foreground"
            >
              رجوع للصفحة الرئيسية
            </Link>
          </div>
        ) : (
          <form onSubmit={activate} noValidate className="mt-6 space-y-4">
            <PasswordField
              id="new-password"
              label="كلمة المرور"
              value={password}
              onChange={setPassword}
              minLength={6}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">6 أحرف على الأقل.</p>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "جارٍ التفعيل…" : "فعّل حسابي"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
