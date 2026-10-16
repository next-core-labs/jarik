import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Building2, KeyRound, User } from "lucide-react";

import { JarakSymbol } from "@/components/jarak-logo";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  portalDestinations,
  resolvePostLoginPath,
  type PortalDestination,
} from "@/lib/portal-routing";
import { useMyRoles } from "@/lib/use-role";

export const Route = createFileRoute("/choose-role")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [{ title: "الدخول كـ — جارك" }, { name: "robots", content: "noindex" }],
  }),
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
  const signedIn = !!me?.userId;

  // Only an account with more than one portal has anything to choose; anyone else goes straight
  // to their own home instead of a screen with no options.
  useEffect(() => {
    if (me?.userId && portalDestinations(me.roles).length < 2) {
      navigate({ to: resolvePostLoginPath(me.roles), replace: true });
    }
  }, [me, navigate]);

  if (!isLoading && !signedIn) {
    return (
      <div className="grid min-h-screen place-items-center bg-background p-6">
        <div className="w-full max-w-sm text-center">
          <JarakSymbol className="mx-auto size-12" />
          <h1 className="font-display mt-4 text-2xl font-bold">سجّل دخولك أولًا</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            هذه الصفحة تختار لوحتك بعد الدخول إلى حسابك.
          </p>
          <Button asChild className="mt-6 w-full">
            <Link to="/auth" search={{ next: "/choose-role" }}>
              تسجيل الدخول
            </Link>
          </Button>
          <Link
            to="/"
            className="mt-4 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            رجوع للصفحة الرئيسية
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-6">
      <div className="w-full max-w-sm text-center">
        <JarakSymbol className="mx-auto size-12" />
        <h1 className="font-display mt-4 text-2xl font-bold">الدخول كـ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          حسابك مربوط بأكثر من صفة — اختر أي لوحة تفتح.
        </p>

        <div className="mt-6 space-y-2">
          {isLoading || dests.length < 2 ? (
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
