import { createFileRoute } from "@tanstack/react-router";

import { PortalLoginPage } from "@/components/portal-login";

export const Route = createFileRoute("/owner/login")({
  staticData: { sitemap: false },
  head: () => ({
    meta: [
      { title: "دخول المالك — جارك" },
      { name: "description", content: "دخول ملّاك العقارات إلى بوابتهم في منصة جارك." },
      // Portal entry point, not search content.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <PortalLoginPage
      title="دخول المالك"
      heroTitle="عقاراتك، إشغالها، وعائدها — بنظرة واحدة."
      heroBody="اختر مكتبًا يدير عقارك أو إدارته بنفسك، وتابع كل تحصيل ومصروف وصيانة."
      allowSelfRegister={true}
    />
  ),
});
