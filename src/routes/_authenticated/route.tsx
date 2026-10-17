import { createFileRoute, Navigate, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/app-shell";
import { JarakSymbol } from "@/components/jarak-logo";

// Which `_authenticated/*` paths each kind of account may open. Every path not listed here is
// office/staff territory: RLS already blocks the underlying data, but anyone else landing on a staff
// screen by URL bounces to their own home immediately instead of seeing an empty/broken page.
// The owner and tenant portals are checked per role, not as one "non-staff" list: a tenant must
// not get the owner portal (or the reverse), and office staff only get either one when the same
// account also holds that role (an account can hold several — see portal-routing.ts).
// Extend these sets, don't special-case more paths below.
const OWNER_PATHS = new Set([
  "/owner-dashboard",
  "/owner/properties",
  "/owner/settings",
  "/owner/agreements",
]);
const TENANT_PATHS = new Set(["/tenant-dashboard", "/tenant/settings"]);
// Open to every signed-in role that uses them (staff, owner, tenant, technician).
const SHARED_PATHS = new Set(["/portal", "/messages", "/documents", "/notifications"]);
// A brand-new "office" signup holds no role at all until register_office() grants one (see
// assign_default_role() / 20260924180000), so this form is for role-less accounts only; anyone
// already in an office (staff, technician) or linked to one (owner, tenant) is sent home.
const REGISTER_OFFICE_PATH = "/register-office";

// A redirect thrown from this beforeLoad during the very first (hydrating) page load breaks
// TanStack Router 1.170 either way: thrown before React hydrates (signed out: getSession() is
// local and instant), the client renders /auth over the server's empty shell, a hydration
// mismatch; thrown after React has mounted the pending match (about 0.5 s in: a slow network, or
// /hq's extra lookup), MatchInner throws the match's cleared loadPromise and the page stays blank.
// So on that first load the bounce is handed to the layout, which shows the loading screen and
// navigates with <Navigate> once hydrated; every later in-app navigation throws the redirect as usual.
let firstLoadDone = false;

export const Route = createFileRoute("/_authenticated")({
  staticData: { sitemap: "exclude-subtree" },
  ssr: false,
  // Cold loads: the server and the hydrating client both render this (the router wraps an
  // `ssr: false` match in ClientOnly with the pending component as fallback), so the page shows
  // the brand loader instead of a blank frame until the gate has decided.
  pendingComponent: AuthenticatedPending,
  // The router's default 0.5 s minimum pending time held every cold load (and every bounce) on that
  // frame, and its timer updated the router before React had committed the hydrated tree ("Can't
  // perform a React state update on a component that hasn't mounted yet").
  pendingMinMs: 0,
  // In-app navigations keep the current page on screen while the gate checks, as before; the
  // loader is only for the first load.
  pendingMs: Infinity,
  beforeLoad: async ({ location }) => {
    // getSession() reads the stored session; getUser() makes a network call and any failure
    // (offline, a flaky moment) looked like "signed out", bouncing the user to /auth, which
    // then sent them straight back. Row-level security still protects the data server-side.
    const firstLoad = !firstLoadDone;
    firstLoadDone = true;

    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    // Keep the page the user asked for, so a deep link survives the login round-trip.
    // Tenant and owner portal pages send a signed-out visitor to that portal's own sign-in, not
    // the office one at /auth.
    if (!user) {
      const next = location.href;
      const signIn = signInPathFor(location.pathname);
      if (firstLoad) return { user: null, bounce: { to: signIn, next } };
      throw redirect({ to: signIn, search: { next } });
    }

    // /hq also needs the delegation row: fetch it alongside the roles, not after them.
    const [{ data: roleRows }, hqDelegation] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id),
      location.pathname === "/hq"
        ? supabase.from("hq_admins").select("permissions").eq("user_id", user.id).maybeSingle()
        : null,
    ]);
    const roles = (roleRows ?? []).map((r) => r.role);
    const staff = roles.some((r) => r === "admin" || r === "staff");
    // super_admin is deliberately outside is_staff/org_isolation scope (its own /hq dashboard
    // gates itself) — without this a super_admin-only account (none today, but the role exists
    // for that purpose) would get bounced off /hq by the generic non-staff redirect below.
    const superAdmin = roles.some((r) => r === "super_admin");

    const bounce = (to: BounceTarget) => {
      if (firstLoad) return { user, bounce: { to } };
      throw redirect({ to });
    };

    // The platform team page is separate from office administration. A regular office admin
    // cannot enter it; delegated team members can, even if they have no office/staff role.
    if (location.pathname === "/hq" && !superAdmin) {
      const delegation = hqDelegation?.data;
      if (hqDelegation?.error || !delegation?.permissions?.length) {
        return bounce(
          roles.includes("owner")
            ? "/owner-dashboard"
            : roles.includes("tenant")
              ? "/tenant-dashboard"
              : staff
                ? "/dashboard"
                : "/portal",
        );
      }
    }

    if (location.pathname === "/hq") return { user, bounce: null };

    const owner = roles.includes("owner");
    const tenant = roles.includes("tenant");
    const technician = roles.includes("technician");
    // A role-less account that chose "مكتب" at signup (assign_default_role() grants it no role on
    // purpose — see 20260924180000) belongs on the office-registration form, not the dead-end
    // "no role" /portal screen.
    const accountType = (user.user_metadata as { account_type?: string } | null)?.account_type;
    const home = staff
      ? "/dashboard"
      : owner
        ? "/owner-dashboard"
        : tenant
          ? "/tenant-dashboard"
          : superAdmin
            ? "/hq"
            : roles.length === 0 && accountType === "office"
              ? REGISTER_OFFICE_PATH
              : "/portal";

    const path = location.pathname;
    const allowed = OWNER_PATHS.has(path)
      ? owner
      : TENANT_PATHS.has(path)
        ? tenant
        : path === REGISTER_OFFICE_PATH
          ? !staff && !owner && !tenant && !technician
          : SHARED_PATHS.has(path) || staff || superAdmin;
    if (!allowed) return bounce(home);

    return { user, bounce: null };
  },

  component: AuthenticatedLayout,
});

function signInPathFor(path: string) {
  return TENANT_PATHS.has(path)
    ? ("/tenant/login" as const)
    : OWNER_PATHS.has(path)
      ? ("/owner/login" as const)
      : ("/auth" as const);
}

type BounceTarget =
  "/dashboard" | "/owner-dashboard" | "/tenant-dashboard" | "/hq" | "/register-office" | "/portal";

function AuthenticatedLayout() {
  const { bounce } = Route.useRouteContext();
  if (bounce) {
    return (
      <>
        {"next" in bounce ? (
          <Navigate to={bounce.to} search={{ next: bounce.next }} replace />
        ) : (
          <Navigate to={bounce.to} replace />
        )}
        <AuthenticatedPending />
      </>
    );
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

/** Full-screen brand loader while the gate decides where a cold load belongs. */
function AuthenticatedPending() {
  return (
    <div className="grid min-h-screen place-items-center bg-background" role="status">
      <JarakSymbol className="size-12 animate-pulse" />
      <span className="sr-only">جارٍ التحميل…</span>
    </div>
  );
}
