import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";

// Every route a non-staff (tenant-only or owner-only, no admin/staff role) session may open. Every
// other `_authenticated/*` path is office/staff territory — RLS already blocks the underlying data
// either way, but a tenant/owner landing on a staff screen by URL should bounce to their own
// dashboard immediately, per the tenant/owner portal specs, instead of rendering an empty/broken
// staff page. Extend this list, don't special-case more paths below.
const NON_STAFF_ALLOWED_PATHS = new Set([
  "/portal",
  "/owner-dashboard",
  "/tenant-dashboard",
  "/messages",
  "/tenant/settings",
  "/owner/settings",
  "/owner/agreements",
  // Both new tenant/owner navs (app-shell.tsx) link here — /documents and /notifications were
  // ALSO already linked from the older generic portalNav (وثائق عقاراتي / الإشعارات) but were
  // missing from this set too, so those links were silently bouncing back to /portal all along;
  // this fixes that pre-existing gap as a side effect, not just the two new settings pages.
  "/documents",
  "/notifications",
  // A brand-new "office" signup holds no role at all until register_office() grants one (see
  // assign_default_role() / 20260924180000) — without this, a role-less account could never even
  // reach the form that grants it a role in the first place.
  "/register-office",
]);

export const Route = createFileRoute("/_authenticated")({
  staticData: { sitemap: "exclude-subtree" },
  ssr: false,
  beforeLoad: async ({ location }) => {
    // getSession() reads the stored session; getUser() makes a network call and any failure
    // (offline, a flaky moment) looked like "signed out", bouncing the user to /auth, which
    // then sent them straight back. Row-level security still protects the data server-side.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    // Keep the page the user asked for, so a deep link survives the login round-trip.
    if (!user) throw redirect({ to: "/auth", search: { next: location.href } });

    const { data: roleRows } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows ?? []).map((r) => r.role);
    const staff = roles.some((r) => r === "admin" || r === "staff");
    // super_admin is deliberately outside is_staff/org_isolation scope (its own /hq dashboard
    // gates itself) — without this a super_admin-only account (none today, but the role exists
    // for that purpose) would get bounced off /hq by the generic non-staff redirect below.
    const superAdmin = roles.some((r) => r === "super_admin");

    // The platform team page is separate from office administration. A regular office admin
    // cannot enter it; delegated team members can, even if they have no office/staff role.
    if (location.pathname === "/hq" && !superAdmin) {
      const { data: delegation, error } = await supabase
        .from("hq_admins")
        .select("permissions")
        .eq("user_id", user.id)
        .maybeSingle();
      if (error || !delegation?.permissions?.length) {
        throw redirect({
          to: roles.includes("owner")
            ? "/owner-dashboard"
            : roles.includes("tenant")
              ? "/tenant-dashboard"
              : staff
                ? "/dashboard"
                : "/portal",
        });
      }
    }

    if (!staff && !superAdmin && location.pathname !== "/hq") {
      if (location.pathname === "/dashboard" || !NON_STAFF_ALLOWED_PATHS.has(location.pathname)) {
        // A role-less account that chose "مكتب" at signup (assign_default_role() grants it no
        // role on purpose — see 20260924180000) belongs on the office-registration form, not the
        // dead-end "no role" /portal screen.
        const accountType = (user.user_metadata as { account_type?: string } | null)?.account_type;
        const fallback = roles.includes("owner")
          ? "/owner-dashboard"
          : roles.includes("tenant")
            ? "/tenant-dashboard"
            : roles.length === 0 && accountType === "office"
              ? "/register-office"
              : "/portal";
        throw redirect({ to: fallback });
      }
    }

    return { user };
  },

  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
});
