import { createFileRoute } from "@tanstack/react-router";

import { PortalLoginPage } from "@/components/portal-login";
import { safeNext } from "@/lib/safe-redirect";

export const Route = createFileRoute("/tenant/login")({
  staticData: { sitemap: false },
  validateSearch: (s: Record<string, unknown>) => {
    const next = safeNext(s["next"]);
    return next ? { next } : {};
  },
  head: () => ({
    meta: [
      { title: "دخول المستأجر — جارك" },
      { name: "description", content: "دخول المستأجرين إلى لوحتهم الخاصة في منصة جارك." },
      // Portal entry point, not search content.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: LoginPage,
});

function LoginPage() {
  const { next } = Route.useSearch() as { next?: string };
  return (
    <PortalLoginPage
      title="دخول المستأجر"
      heroTitle="عقدك ومستحقاتك وطلبات صيانتك في مكان واحد."
      heroBody="تابع دفعاتك القادمة، جدّد عقدك أو اطلب مغادرته، وتواصل مع مكتبك مباشرة."
      allowSelfRegister={false}
      next={next}
    />
  );
}
