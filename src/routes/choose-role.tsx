import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Building2, KeyRound, User } from "lucide-react";

import jarakLogo from "@/assets/jarak-logo.png";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { portalDestinations, type PortalDestination } from "@/lib/portal-routing";
import { useMyRoles } from "@/lib/use-role";

export const Route = createFileRoute("/choose-role")({
  staticData: { sitemap: false },
  head: () => ({ meta: [{ title: "الدخول كـ — جارك" }] }),
  component: ChooseRole,
});

const ICON: Record<PortalDestination["role"], typeof Building2> = {
  office: Building2,
  owner: KeyRound,
  tenant: User,
};

/** حساب بأكثر من هوية (مثلًا موظف مكتب ومالك بنفس الوقت) يختار من هنا أي لوحة يفتح. */
function ChooseRole() {
  const navigate = useNavigate();
  const { data: me, isLoading } = useMyRoles();
  const dests = portalDestinations(me?.roles ?? []);

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <img
          src={jarakLogo}
          alt="جارك"
          width={48}
          height={48}
          className="mx-auto size-12 bg-background p-1"
        />
        <h1 className="font-display mt-4 text-2xl font-bold">الدخول كـ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          حسابك مربوط بأكثر من صفة — اختر أي لوحة تفتح.
        </p>

        <div className="mt-6 space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ التحميل…</p>
          ) : (
            dests.map((d) => {
              const Icon = ICON[d.role];
              return (
                <Button
                  key={d.role}
                  variant="outline"
                  className="h-14 w-full justify-start gap-3 text-base"
                  onClick={() => navigate({ to: d.path, replace: true })}
                >
                  <Icon className="size-5" />
                  {d.label}
                </Button>
              );
            })
          )}
        </div>

        <button
          type="button"
          className="mt-6 text-sm text-muted-foreground hover:text-foreground"
          onClick={async () => {
            await supabase.auth.signOut();
            navigate({ to: "/auth", replace: true });
          }}
        >
          تسجيل الخروج
        </button>
      </div>
    </div>
  );
}
