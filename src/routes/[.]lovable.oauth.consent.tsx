import { createFileRoute, redirect } from "@tanstack/react-router";
import { useState } from "react";

import { JarakLogo } from "@/components/jarak-logo";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type OAuthDetails = {
  client?: { name?: string | null } | null;
  redirect_url?: string | null;
  redirect_to?: string | null;
};

type OAuthResult = { data: OAuthDetails | null; error: { message: string } | null };

type OAuthApi = {
  getAuthorizationDetails: (id: string) => Promise<OAuthResult>;
  approveAuthorization: (id: string) => Promise<OAuthResult>;
  denyAuthorization: (id: string) => Promise<OAuthResult>;
};

function oauthApi(): OAuthApi {
  return (supabase.auth as unknown as { oauth: OAuthApi }).oauth;
}

export const Route = createFileRoute("/.lovable/oauth/consent")({
  staticData: { sitemap: false },
  // Browser-only: the Supabase client reads its session from localStorage,
  // which is absent during the SSR pass.
  ssr: false,
  validateSearch: (s: Record<string, unknown>) => ({
    authorization_id: typeof s["authorization_id"] === "string" ? s["authorization_id"] : "",
  }),
  beforeLoad: async ({ search, location }) => {
    if (!search.authorization_id) throw new Error("Missing authorization_id");
    const { data } = await supabase.auth.getSession();
    const next = location.pathname + location.searchStr;
    if (!data.session) throw redirect({ to: "/auth", search: { next } });
  },
  loader: async ({ location }) => {
    const authorizationId = new URLSearchParams(location.search).get("authorization_id")!;
    const { data, error } = await oauthApi().getAuthorizationDetails(authorizationId);
    if (error) throw error;
    const immediate = data?.redirect_url ?? data?.redirect_to;
    if (immediate && !data?.client) throw redirect({ href: immediate });
    return data;
  },
  component: Consent,
  errorComponent: ({ error }) => (
    <main className="flex min-h-screen items-center justify-center p-6">
      <p className="text-sm text-muted-foreground">
        تعذّر تحميل طلب الربط: {String((error as Error)?.message ?? error)}
      </p>
    </main>
  ),
});

function Consent() {
  const details = Route.useLoaderData();
  const { authorization_id } = Route.useSearch();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientName = details?.client?.name ?? "التطبيق";

  async function decide(approve: boolean) {
    setBusy(true);
    setError(null);
    const api = oauthApi();
    const { data, error } = approve
      ? await api.approveAuthorization(authorization_id)
      : await api.denyAuthorization(authorization_id);
    if (error) {
      setBusy(false);
      setError(error.message);
      return;
    }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) {
      setBusy(false);
      setError("لم يرجع خادم الصلاحيات عنوان إعادة التوجيه.");
      return;
    }
    window.location.href = target;
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-card-foreground shadow-sm">
        <div className="flex items-center gap-2">
          <JarakLogo />
        </div>

        <h1 className="mt-6 font-display text-xl font-bold">ربط {clientName} بحسابك</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          سيتمكّن «{clientName}» من قراءة بيانات حسابك في جارك (العقارات والوحدات والعقود والتحصيل
          والصيانة) وإضافة طلبات صيانة وصفقات نيابةً عنك — بنفس صلاحياتك تمامًا.
        </p>

        {error ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex gap-3">
          <Button className="flex-1" disabled={busy} onClick={() => decide(true)}>
            موافقة
          </Button>
          <Button
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={() => decide(false)}
          >
            رفض
          </Button>
        </div>
      </div>
    </main>
  );
}
