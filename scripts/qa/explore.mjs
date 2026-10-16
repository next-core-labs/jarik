// Clicks every interactive element on the given routes and reports what each one did.
//
//   node scripts/qa/explore.mjs --role owner --routes /owner-dashboard,/owner/settings --out <dir> [--mobile]
//
// For each route: load it, record load errors, then for every visible button / tab / menu item /
// switch / checkbox / select trigger: click it, watch for an effect (navigation, dialog or menu,
// toast, network call, blocked write, DOM change, aria state change, download, new tab), then
// restore the page (Escape, re-open the route). Links are collected and each unique internal href is
// opened once to confirm it renders. Writes are blocked by session.mjs — see its header.
//
// Output: <out>/report.json, <out>/report.md (human summary), <out>/shots/*.png.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { openSession } from "./session.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => {
    if (a.startsWith("--"))
      acc.push([
        a.slice(2),
        all[i + 1]?.startsWith("--") || all[i + 1] === undefined ? "true" : all[i + 1],
      ]);
    return acc;
  }, []),
);
const role = args.role ?? "anon";
const routes = (args.routes ?? "/")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const out = args.out ?? `qa-out/${role}`;
const mobile = args.mobile === "true";
const maxClicks = Number(args["max-clicks"] ?? 80);
mkdirSync(join(out, "shots"), { recursive: true });

const s = await openSession({ role, mobile });
const { page, events } = s;

// Count DOM mutations so a click that changes nothing visible can be told apart from one that does.
await s.context.addInitScript(() => {
  window.__qaMut = 0;
  new MutationObserver((l) => (window.__qaMut += l.length)).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
});

const slug = (t) => t.replace(/[^\p{L}\p{N}]+/gu, "-").slice(0, 50);
const settle = async (ms = 700) => {
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(ms);
};
const snapshotEvents = () => ({
  console: events.console.length,
  pageErrors: events.pageErrors.length,
  failed: events.failed.length,
  blocked: events.blocked.length,
});
const since = (snap) => ({
  consoleErrors: events.console
    .slice(snap.console)
    .filter((e) => e.type === "error")
    .map((e) => e.text),
  pageErrors: events.pageErrors.slice(snap.pageErrors).map((e) => e.text),
  failed: events.failed.slice(snap.failed).map((e) => `${e.status} ${e.method} ${e.url}`),
  blocked: events.blocked.slice(snap.blocked).map((e) => e.what),
});

const CANDIDATES = [
  "button",
  "[role=button]",
  "[role=tab]",
  "[role=menuitem]",
  "[role=switch]",
  "[role=checkbox]",
  "[role=combobox]",
  "[role=radio]",
  "summary",
  "input[type=checkbox]",
  "input[type=radio]",
  "a[href]",
].join(",");

/** Visible interactive elements, described stably enough to find again after a reload. */
async function collect() {
  return page.evaluate((sel) => {
    const seen = new Map();
    const res = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      if (r.width < 2 || r.height < 2 || st.visibility === "hidden" || st.display === "none")
        continue;
      if (el.closest("[aria-hidden=true]")) continue;
      const label = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        el
          .querySelector("svg")
          ?.getAttribute("class")
          ?.match(/lucide-([\w-]+)/)?.[1] ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
      const tag = el.tagName.toLowerCase();
      const roleAttr = el.getAttribute("role") || "";
      const href = tag === "a" ? el.getAttribute("href") : null;
      const key = `${tag}|${roleAttr}|${label}|${href ?? ""}`;
      const nth = seen.get(key) ?? 0;
      seen.set(key, nth + 1);
      const anchorOk =
        href?.startsWith("#") && href.length > 1
          ? !!document.getElementById(decodeURIComponent(href.slice(1)))
          : undefined;
      res.push({
        key,
        nth,
        tag,
        role: roleAttr,
        label,
        href,
        anchorOk,
        disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
        inDialog: !!el.closest("[role=dialog],[role=alertdialog]"),
      });
    }
    return res;
  }, CANDIDATES);
}

async function locate(item) {
  const handles = await page.$$(CANDIDATES);
  let n = 0;
  for (const h of handles) {
    const k = await h.evaluate((el) => {
      const label = (
        el.getAttribute("aria-label") ||
        el.innerText ||
        el.getAttribute("title") ||
        el.getAttribute("placeholder") ||
        el
          .querySelector("svg")
          ?.getAttribute("class")
          ?.match(/lucide-([\w-]+)/)?.[1] ||
        ""
      )
        .trim()
        .replace(/\s+/g, " ")
        .slice(0, 80);
      const tag = el.tagName.toLowerCase();
      return `${tag}|${el.getAttribute("role") || ""}|${label}|${tag === "a" ? el.getAttribute("href") : ""}`;
    });
    if (k === item.key) {
      if (n === item.nth) return h;
      n++;
    }
  }
  return null;
}

const observe = () =>
  page.evaluate(() => ({
    url: location.pathname + location.search + location.hash,
    mut: window.__qaMut ?? 0,
    dialogs: document.querySelectorAll("[role=dialog],[role=alertdialog]").length,
    menus: document.querySelectorAll(
      "[role=menu],[role=listbox],[data-radix-popper-content-wrapper]",
    ).length,
    toasts: [...document.querySelectorAll("[data-sonner-toast]")].map((t) =>
      t.innerText.trim().replace(/\s+/g, " ").slice(0, 160),
    ),
    expanded: [
      ...document.querySelectorAll(
        "[aria-expanded],[aria-selected],[aria-checked],[aria-pressed],[aria-current],[data-state]",
      ),
    ]
      .map(
        (e) =>
          e.getAttribute("aria-expanded") +
          e.getAttribute("aria-selected") +
          e.getAttribute("aria-checked") +
          e.getAttribute("aria-pressed") +
          e.getAttribute("aria-current") +
          e.getAttribute("data-state"),
      )
      .join(""),
    notFound:
      /not found|الصفحة غير موجودة|404/i.test(document.body.innerText.slice(0, 2000)) &&
      document.body.innerText.length < 4000,
    bodyLen: document.body.innerText.length,
  }));

const report = {
  role,
  mobile,
  base: s.url("/"),
  startedAt: new Date().toISOString(),
  routes: [],
  links: [],
};
const allLinks = new Map();
let shotN = 0;
const shot = async (name) => {
  const f = `shots/${String(++shotN).padStart(3, "0")}-${slug(name)}.png`;
  await page.screenshot({ path: join(out, f), fullPage: false }).catch(() => {});
  return f;
};

for (const route of routes) {
  const r = { route, load: {}, elements: [] };
  report.routes.push(r);
  const snap0 = snapshotEvents();
  const t0 = Date.now();
  await page
    .goto(s.url(route), { waitUntil: "domcontentloaded", timeout: 60000 })
    .catch((e) => (r.load.gotoError = e.message));
  await settle(1500);
  const o0 = await observe();
  r.load = {
    ...r.load,
    ms: Date.now() - t0,
    finalUrl: o0.url,
    redirected: o0.url.split("?")[0] !== route.split("?")[0],
    notFound: o0.notFound,
    textLength: o0.bodyLen,
    shot: await shot(`load${route}`),
    ...since(snap0),
  };
  await page
    .screenshot({ path: join(out, `shots/full-${slug(route)}.png`), fullPage: true })
    .catch(() => {});

  const items = (await collect()).filter((i) => !i.inDialog);
  for (const it of items.filter((i) => i.tag === "a" && i.href)) {
    if (it.href.startsWith("#"))
      r.anchors = [
        ...(r.anchors ?? []),
        { href: it.href, label: it.label, targetExists: it.anchorOk },
      ];
    else allLinks.set(it.href, { from: route, label: it.label });
  }
  const clickables = items.filter((i) => !(i.tag === "a" && i.href));
  let clicks = 0;
  for (const it of clickables) {
    if (clicks >= maxClicks) {
      r.truncated = clickables.length - clicks;
      break;
    }
    const entry = { label: it.label || "(no label)", tag: it.tag, role: it.role, nth: it.nth };
    r.elements.push(entry);
    if (it.disabled) {
      entry.result = "DISABLED";
      continue;
    }
    // Signing out would end the run's session; agents test it on its own at the end.
    if (/خروج|log ?out|sign ?out/i.test(it.label)) {
      entry.result = "SKIPPED_SIGNOUT";
      continue;
    }
    // Restore the route between clicks if a previous one navigated away or left an overlay open.
    const cur = await observe();
    if (cur.url.split("?")[0] !== o0.url.split("?")[0] || cur.dialogs || cur.menus) {
      await page.goto(s.url(route), { waitUntil: "domcontentloaded" }).catch(() => {});
      await settle(800);
    }
    const h = await locate(it);
    if (!h) {
      entry.result = "NOT_FOUND_AFTER_RELOAD";
      continue;
    }
    clicks++;
    const before = await observe();
    const snap = snapshotEvents();
    const popup = s.context.waitForEvent("page", { timeout: 1500 }).catch(() => null);
    const download = page.waitForEvent("download", { timeout: 1500 }).catch(() => null);
    try {
      await h.scrollIntoViewIfNeeded({ timeout: 2000 });
      await h.click({ timeout: 4000 });
    } catch (e) {
      entry.result = "CLICK_FAILED";
      entry.error = e.message.split("\n")[0];
      continue;
    }
    await settle(600);
    const after = await observe();
    const [pp, dl] = await Promise.all([popup, download]);
    const d = since(snap);
    const effects = [];
    if (after.url !== before.url) effects.push(`navigated → ${after.url}`);
    if (after.dialogs > before.dialogs) effects.push("opened dialog");
    if (after.menus > before.menus) effects.push("opened menu/popover");
    const newToasts = after.toasts.filter((t) => !before.toasts.includes(t));
    if (newToasts.length) effects.push(`toast: ${newToasts.join(" | ")}`);
    if (d.blocked.length) effects.push(`write blocked: ${d.blocked.join(", ")}`);
    if (after.expanded !== before.expanded)
      effects.push("state changed (expanded/selected/checked)");
    if (dl) effects.push(`download: ${dl.suggestedFilename()}`);
    if (pp) {
      effects.push(`new tab: ${pp.url()}`);
      await pp.close().catch(() => {});
    }
    if (!effects.length && after.mut - before.mut > 5)
      effects.push(`DOM changed (${after.mut - before.mut} mutations)`);
    entry.effects = effects;
    entry.errors = [...d.pageErrors, ...d.consoleErrors, ...d.failed];
    entry.result = entry.errors.length ? "ERROR" : effects.length ? "OK" : "NO_EFFECT";
    if (entry.result !== "OK" || after.dialogs > before.dialogs)
      entry.shot = await shot(`${route}-${entry.label}`);
    if (after.notFound) entry.result = "LEADS_TO_404";
    await page.keyboard.press("Escape").catch(() => {});
    await page.keyboard.press("Escape").catch(() => {});
  }
}

// Open every unique internal link once.
for (const [href, meta] of allLinks) {
  if (!href.startsWith("/") || href.startsWith("//")) {
    report.links.push({
      href,
      ...meta,
      result: /^(https?:|mailto:|tel:|wa\.me|whatsapp:)/.test(href) ? "EXTERNAL" : "ODD_HREF",
    });
    continue;
  }
  if (href.startsWith("/#") || href === "#") {
    report.links.push({ href, ...meta, result: "ANCHOR" });
    continue;
  }
  const snap = snapshotEvents();
  const resp = await page
    .goto(s.url(href), { waitUntil: "domcontentloaded", timeout: 45000 })
    .catch((e) => ({ status: () => 0, err: e.message }));
  await settle(800);
  const o = await observe();
  const d = since(snap);
  const errors = [...d.pageErrors, ...d.consoleErrors, ...d.failed];
  report.links.push({
    href,
    ...meta,
    status: resp?.status?.() ?? 0,
    finalUrl: o.url,
    result:
      o.notFound || resp?.status?.() === 404 ? "LEADS_TO_404" : errors.length ? "ERROR" : "OK",
    errors,
    blocked: d.blocked,
  });
}

report.finishedAt = new Date().toISOString();
report.blockedWrites = events.blocked;
report.dialogs = events.dialogs;
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));

// Human summary.
const md = [`# Explore — role: ${role}${mobile ? " (mobile 390px)" : ""}`, ""];
for (const r of report.routes) {
  md.push(
    `## ${r.route} → ${r.load.finalUrl}${r.load.redirected ? " (REDIRECTED)" : ""}${r.load.notFound ? " **404**" : ""} — ${r.load.ms} ms`,
  );
  for (const k of ["pageErrors", "consoleErrors", "failed", "blocked"])
    if (r.load[k]?.length) md.push(`- load ${k}: ${r.load[k].slice(0, 6).join(" ‖ ")}`);
  const count = (x) => r.elements.filter((e) => e.result === x).length;
  md.push(
    `- elements: ${r.elements.length} (OK ${count("OK")}, NO_EFFECT ${count("NO_EFFECT")}, ERROR ${count("ERROR")}, CLICK_FAILED ${count("CLICK_FAILED")}, DISABLED ${count("DISABLED")}, 404 ${count("LEADS_TO_404")})${r.truncated ? ` — ${r.truncated} more not clicked (max-clicks)` : ""}`,
  );
  for (const a of (r.anchors ?? []).filter((a) => a.targetExists === false))
    md.push(`  - **BROKEN_ANCHOR** \`${a.label}\` → ${a.href} (no element with that id)`);
  for (const e of r.elements.filter((e) => e.result !== "OK" && e.result !== "DISABLED"))
    md.push(
      `  - **${e.result}** \`${e.label}\` (${e.tag}${e.role ? `/${e.role}` : ""})${e.error ? ` — ${e.error}` : ""}${e.errors?.length ? ` — ${e.errors.slice(0, 3).join(" ‖ ")}` : ""}${e.shot ? ` [${e.shot}]` : ""}`,
    );
  for (const e of r.elements.filter((e) => e.result === "OK"))
    md.push(`  - ok \`${e.label}\` → ${e.effects.join("; ")}`);
  md.push("");
}
md.push("## Links");
for (const l of report.links.filter((l) => !["OK", "EXTERNAL", "ANCHOR"].includes(l.result)))
  md.push(
    `- **${l.result}** ${l.href} (from ${l.from}, "${l.label}") ${l.errors?.slice(0, 2).join(" ‖ ") ?? ""}`,
  );
md.push(
  `- ${report.links.filter((l) => l.result === "OK").length} internal links OK, ${report.links.filter((l) => l.result === "EXTERNAL").length} external (not opened)`,
);
md.push(
  "",
  `## Writes blocked by the QA guard (${events.blocked.length})`,
  ...[...new Set(events.blocked.map((b) => b.what))].map((w) => `- ${w}`),
);
writeFileSync(join(out, "report.md"), md.join("\n"));
console.log(`report: ${join(out, "report.md")}`);
await s.close();
