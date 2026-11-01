import { Navigate, createFileRoute } from "@tanstack/react-router";

// «المستخدمون والأدوار» used to list every account on the platform to any office manager and let
// them change any role, «مدير النظام» included. Accounts and roles are managed only by مدير النظام in
// /hq «المشتركون» now; old links land there, and the route gate sends everyone else to their home.
// <Navigate>, not a redirect thrown from beforeLoad: that breaks a cold load (see _authenticated/route.tsx).
export const Route = createFileRoute("/_authenticated/users")({
  staticData: { sitemap: false },
  component: () => <Navigate to="/hq" replace />,
});
