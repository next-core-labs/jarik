# QA playbook (shared by the `qa-*` subagents in `.claude/agents/`)

Every QA agent reads this first. It covers how to log in, how to click through an app without
touching live data, and what a finished report looks like.

## Ground rules

1. **The only database is the live Supabase project.** Never submit, save, send, delete, approve
   or pay for real. `scripts/qa/session.mjs` blocks every write at the network layer and answers it
   with a `403 QA guard` response. Only drive the browser through `openSession()` or `explore.mjs`.
   Never through a raw Playwright browser, curl POSTs, or the Supabase client.
2. **You are QA, not a developer.** Don't edit anything under `src/`, `supabase/` or config. Read
   source code only to explain a failure and point at the cause (`file:line`).
3. A write blocked by the guard is **expected**, not a bug. If clicking "Save" logs
   `write blocked: …`, the button is wired correctly. Report it as working. The error toast that
   follows ("تعذّر …") is caused by the guard. Do report a submit button that produces **no** blocked
   write and no validation message, because that's a dead button.
4. Fill forms freely: typing, selecting, picking dates and uploading are fine because they stay in
   the browser. Do check validation: submit empty, submit an invalid email, phone, ID or amount, and
   confirm a clear Arabic error appears.
5. The UI is Arabic and right-to-left. Match buttons by their Arabic text or aria-label.

## Setup (once per machine, already done if `.env.qa.local` exists)

```bash
node scripts/qa/setup.mjs     # 4 QA accounts + private "QA-" office + small fixture (idempotent)
npm run dev                   # dev server on http://localhost:8080 (QA_BASE_URL overrides)
node scripts/qa/teardown.mjs  # removes all of it
```

Accounts (credentials in the git-ignored `.env.qa.local`):

| role arg     | Account                                                                | Lands on            |
| ------------ | ---------------------------------------------------------------------- | ------------------- |
| `office`     | QA office manager (staff, manager)                                     | `/dashboard`        |
| `owner`      | QA property owner of building "QA-Building A"                          | `/owner-dashboard`  |
| `tenant`     | QA tenant leasing unit QA-101 (1 paid, 1 overdue, 2 upcoming payments) | `/tenant-dashboard` |
| `technician` | QA maintenance technician, assigned job "QA-تسريب في المطبخ"           | `/portal`           |
| `anon`       | not signed in                                                          | public site         |

Fixture: 1 property, units QA-101 (leased) and QA-102 (vacant, not on the market), 1 active
lease, 4 payments, and 2 maintenance jobs: "QA-تسريب في المطبخ" in progress and "QA-تبديل إنارة الصالة" done. The QA office is unlisted, so none of this
shows on the public site.

If `curl -s -o /dev/null -w '%{http_code}' http://localhost:8080/` is not `200`, stop and report
that the dev server is down. Don't start another one, and never kill node or vite processes
(no `pkill`, no `kill $(lsof -t …)`): other QA agents share the same server. If it's unreachable,
wait 30 seconds and retry. Results from while it was down are not app bugs.

## Step 1: automatic click-through (`explore.mjs`)

```bash
node scripts/qa/explore.mjs --role <role> --routes /a,/b,/c --out qa-out/<app>/<batch> [--mobile] [--max-clicks 80]
```

For each route it records load errors, clicks every visible button, tab, menu item, switch and
checkbox, records what each did, and opens every internal link once. Read `report.md` first, then
`report.json` and the screenshots in `shots/`. Result codes:

- `OK`: the click had a visible effect (navigation, dialog, menu, toast, state change, download,
  network write). Still spot-check that the effect is the **right** one.
- `NO_EFFECT`: nothing observable happened. **Verify by hand** (step 2). It's a real bug only if
  the button really does nothing. An already-selected tab or filter is not a bug.
- `ERROR`: a JS exception, console error or failed request (not a guard block) after the click.
- `CLICK_FAILED`: covered, off-screen or detached. Check whether a user could actually click it.
- `LEADS_TO_404` / `BROKEN_ANCHOR`: a link to nowhere.
- `SKIPPED_SIGNOUT`: test sign-out yourself, last.

Run batches of 4–8 routes. Independent batches can run in parallel (`&` then `wait`). Run
`--mobile` (390px wide) on the main pages too, because layout bugs on phones count.

## Step 2: feature checks by hand (your own Playwright scripts)

The crawler can't judge whether a feature is _correct_. Write small scripts in your scratchpad or
`qa-out/<app>/scripts/`:

```js
import { openSession } from "<repo root>/scripts/qa/session.mjs"; // absolute path
const s = await openSession({ role: "owner" /*, mobile: true */ });
const { page, events } = s;
await page.goto(s.url("/owner-dashboard"));
await page.getByRole("button", { name: "حدّد قرارك" }).click();
await page.screenshot({ path: "qa-out/owner-dashboard/renewal-dialog.png" });
console.log(JSON.stringify(events, null, 2)); // console, pageErrors, failed, blocked, dialogs
await s.close();
```

Check each feature in your app's checklist. Confirm the numbers shown match the fixture (for
example, the rent of 36,000 and the overdue 9,000), that dialogs open with the right content and close,
that tabs, filters, search and sort change the list, that exports download a non-empty file, that
maps and charts render, and that empty, loading and error states read sensibly. Also confirm that
role boundaries hold: your role must be bounced away from pages it doesn't own.

## Step 3: report

Return the report as your final message in this format. The session that launched you saves it as
`qa-out/<app>/FINDINGS.md`, because subagents can't write report files themselves:

```md
# QA — <app> (<date>)

Coverage: <routes visited> · <elements clicked> · desktop + mobile

## Findings

### [P1] <short title>

- Where: /route → element "label"
- Steps: 1… 2… 3…
- Expected / Actual: …
- Evidence: qa-out/<app>/…png, console: "…"
- Likely cause: src/…/file.tsx:123 (why)
- Reproduced: 2/2

## Works

- one line per feature that passed

## Not tested (and why)
```

Severity: **P0** crash, blank page, data from another account visible, or an access-control
hole. **P1** a feature that doesn't work. **P2** a dead button, wrong number or label, or a broken
link. **P3** cosmetic, copy, RTL or mobile layout. Only report what you reproduced. Your final message
to the caller is a short summary: counts per severity, the top issues, and the path to
FINDINGS.md.
