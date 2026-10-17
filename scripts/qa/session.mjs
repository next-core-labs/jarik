// A signed-in, write-guarded Playwright session for QA. Agents import this in their own scripts:
//
//   import { openSession } from "<repo>/scripts/qa/session.mjs";
//   const s = await openSession({ role: "owner" });          // role: office|owner|tenant|technician|anon
//   await s.page.goto(s.url("/owner-dashboard"));
//   ...  s.events (console errors, page errors, failed + blocked requests)  ...
//   await s.close();
//
// The live Supabase project is the only database, so every write is stopped at the network layer
// and answered with a 403 — table inserts/updates/deletes, write RPCs, storage uploads, auth
// changes (incl. logout, which would revoke the shared QA session) and POST server functions.
// Each blocked call is recorded in s.events.blocked: a button that produces one IS wired up.
import { chromium } from "playwright";
import { STORAGE_KEY, SUPABASE_URL, signIn } from "./lib.mjs";

export const BASE_URL = process.env.QA_BASE_URL ?? "http://localhost:8080";

// RPCs that only read. Anything not listed here is treated as a write and blocked.
// my_referral_code / my_reference_code create the caller's own code on first call; setup.mjs
// creates both for every QA account up front, so from then on they only read.
const READ_RPCS = new Set([
  "effective_maintenance_caps",
  "has_role",
  "hq_admin_invitations",
  "hq_list_offices",
  "is_staff",
  "list_hq_admins",
  "market_stats",
  "my_agreement_offices",
  "my_direct_conversations",
  "my_hq_invitations",
  "my_invitations",
  "my_link_requests",
  "my_org_id",
  "my_reference_code",
  "my_referral_code",
  "office_agreement_requests",
  "office_invitations",
  "office_link_requests",
  "office_people",
  "offices_near",
  "org_of",
  "org_user_ids",
  "orgs_of_user",
  "owner_cashflow_forecast",
  "owner_expenses_12m",
  "owner_finance_summary",
  "owner_offices",
  "owner_pending_approvals",
  "owner_property_locations",
  "owner_property_returns",
  "owner_property_roi",
  "owner_renewals",
  "owner_units",
  "owner_vacancies",
  "site_visit_stats",
  "technician_job_contacts",
  "tenant_overdue_count",
]);
// POST server functions that only read.
const READ_SERVER_FNS = [
  "listClientAccounts",
  "listDemoRequests",
  "subscriberDirectory",
  "subscriberActivityLog",
  "subscriberOverview",
  "platformAuditLog",
];

function serverFnId(pathname) {
  const m = pathname.match(/\/_serverFn\/([^/?]+)/);
  if (!m) return decodeURIComponent(pathname);
  try {
    return Buffer.from(m[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return decodeURIComponent(pathname);
  }
}

function classify(req) {
  const url = new URL(req.url());
  const method = req.method();
  const read = method === "GET" || method === "HEAD" || method === "OPTIONS";
  if (url.origin === new URL(SUPABASE_URL).origin) {
    const p = url.pathname;
    if (p.startsWith("/rest/v1/rpc/")) {
      const fn = p.slice("/rest/v1/rpc/".length);
      return READ_RPCS.has(fn) ? null : `rpc ${fn}`;
    }
    if (p.startsWith("/rest/v1/"))
      return read ? null : `${method} table ${p.slice(9)}${url.search}`;
    if (p.startsWith("/auth/v1/")) {
      if (read || p === "/auth/v1/token") return null; // session refresh
      return `auth ${method} ${p.slice(9)}`;
    }
    if (p.startsWith("/storage/v1/")) {
      if (read || /\/object\/(sign|list)\//.test(p)) return null;
      return `storage ${method} ${p.slice(12)}`;
    }
    if (p.startsWith("/functions/v1/")) return `edge function ${p.slice(14)}`;
    return read ? null : `supabase ${method} ${p}`;
  }
  if (url.origin === new URL(BASE_URL).origin && !read) {
    // Server-function URLs carry their id as base64 JSON (/_serverFn/eyJmaWxl…): decode it to
    // match function names and to log something readable.
    const id = serverFnId(url.pathname);
    if (READ_SERVER_FNS.some((n) => id.includes(n))) return null;
    return `server ${method} ${id.slice(0, 160)}`;
  }
  return null;
}

/**
 * @param {{ role?: "office"|"owner"|"tenant"|"technician"|"anon", mobile?: boolean, headless?: boolean }} opts
 */
export async function openSession({ role = "anon", mobile = false, headless = true } = {}) {
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    acceptDownloads: true,
    ...(mobile
      ? {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
          isMobile: true,
          hasTouch: true,
        }
      : { viewport: { width: 1440, height: 900 } }),
  });

  const events = { console: [], pageErrors: [], failed: [], blocked: [], dialogs: [] };
  const now = () => new Date().toISOString().slice(11, 19);

  if (role !== "anon") {
    const { session } = await signIn(role);
    // Put the session back only when it is missing (e.g. after a sign-out click), so an
    // auto-refreshed token is never overwritten with the stale original.
    await context.addInitScript(
      ([key, value]) => {
        try {
          if (!localStorage.getItem(key)) localStorage.setItem(key, value);
        } catch {}
      },
      [STORAGE_KEY, JSON.stringify(session)],
    );
  }

  await context.route("**/*", async (route) => {
    const req = route.request();
    const why = classify(req);
    if (!why) return route.continue();
    let body = req.postData() ?? "";
    if (body.length > 300) body = body.slice(0, 300) + "…";
    events.blocked.push({ t: now(), what: why, body });
    // TanStack server functions read any JSON body as a successful result, so a 403 would show
    // a false success toast. Fail those like a dropped connection instead.
    if (why.startsWith("server ")) return route.abort("blockedbyclient");
    return route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "QA guard: write blocked", code: "QA_BLOCKED" }),
    });
  });

  const page = await context.newPage();
  const watch = (p) => {
    p.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning")
        events.console.push({
          t: now(),
          type: m.type(),
          text: m.text().slice(0, 500),
          url: p.url(),
        });
    });
    p.on("pageerror", (e) =>
      events.pageErrors.push({ t: now(), text: String(e?.stack ?? e).slice(0, 800), url: p.url() }),
    );
    p.on("response", (r) => {
      if (r.status() >= 400 && !r.request().url().startsWith("data:"))
        r.text()
          .catch(() => "")
          .then((body) => {
            if (body.includes("QA_BLOCKED")) return;
            events.failed.push({
              t: now(),
              status: r.status(),
              method: r.request().method(),
              url: r.url().slice(0, 300),
              body: body.slice(0, 300),
              page: p.url(),
            });
          });
    });
    p.on("requestfailed", (r) => {
      const err = r.failure()?.errorText ?? "";
      if (!/ERR_ABORTED|ERR_BLOCKED_BY_CLIENT/.test(err))
        events.failed.push({
          t: now(),
          status: 0,
          method: r.method(),
          url: r.url().slice(0, 300),
          body: err,
          page: p.url(),
        });
    });
    p.on("dialog", (d) => {
      events.dialogs.push({ t: now(), type: d.type(), message: d.message() });
      d.dismiss().catch(() => {});
    });
  };
  watch(page);
  context.on("page", watch);

  return {
    browser,
    context,
    page,
    events,
    role,
    url: (path) => new URL(path, BASE_URL).href,
    close: () => browser.close(),
  };
}
