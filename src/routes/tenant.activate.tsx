import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import jarakLogo from "@/assets/jarak-logo.png";
import { PasswordField } from "@/components/password-field";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { resolvePostLoginPath } from "@/lib/portal-routing";
import { completeTenantActivation } from "@/lib/tenant-portal.functions";
import type { AppRole } from "@/lib/use-role";

export const Route = createFileRoute("/tenant/activate")({
  staticData: { sitemap: false },
  head: () => ({ meta: [{ title: "تفعيل حساب المستأجر — جارك" }] }),
  component: ActivateTenant,
});

/**
 * الوجهة بعد الضغط على رابط دعوة Supabase (inviteUserByEmail): يفتح الرابط جلسة تلقائيًا (نفس
 * آلية رابط استرجاع كلمة المرور)، وهذه الصفحة تطلب من المستأجر تعيين كلمة مرور لأول مرة، ثم تربط
 * حسابه بسجل tenants الخاص بعقده عبر completeTenantActivation.
 */
function ActivateTenant() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setReady(!!data.session));
  }, []);

  async function activate(e: React.FormEvent) {
    e.preventDefault();
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
      toast.error(err instanceof Error ? err.message : "تعذّر تفعيل الحساب");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm">
        <img
          src={jarakLogo}
          alt="جارك"
          width={48}
          height={48}
          className="mx-auto size-12 bg-background p-1"
        />
        <h1 className="font-display mt-4 text-center text-2xl font-bold">تفعيل حسابك</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          دعاك مكتبك العقاري — عيّن كلمة مرور لإكمال حسابك.
        </p>

        {!ready ? (
          <p className="mt-6 text-center text-sm text-muted-foreground">
            هذا الرابط انتهى أو غير صحيح — اطلب من المكتب دعوة جديدة.
          </p>
        ) : (
          <form onSubmit={activate} className="mt-6 space-y-4">
            <PasswordField
              id="new-password"
              label="كلمة المرور"
              value={password}
              onChange={setPassword}
              minLength={6}
              autoComplete="new-password"
            />
            <Button type="submit" className="w-full" disabled={loading || password.length < 6}>
              {loading ? "جارٍ التفعيل…" : "فعّل حسابي"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
