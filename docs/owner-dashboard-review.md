# Owner dashboard — review, fixes and migration baseline

Review of `/owner-dashboard` (logic, data access, design), what was fixed, and what is still open.
Dates: review 2026-10-03, fixes 2026-10-03 → 2026-10-04.

## Before you deploy

1. Let Lovable apply both new migrations **before** the front-end changes go live:
   - `supabase/migrations/20261003120000_owner_dashboard_scoped_rpcs.sql`
   - `supabase/migrations/20261004100000_owner_access_fixes.sql`
   - `supabase/migrations/20261008100000_owner_property_locations.sql` (map). Optional: until it is
     applied, the map falls back to the properties the owner owns outright.
   - `supabase/migrations/20261008120000_owner_features.sql` (owner features below). Optional: until
     it is applied, the forecast, expenses, vacant units and renewal decisions are left out, and
     renewals fall back to "ناقش التجديد".

   Until the first one is applied, the dashboard shows its error screen with a retry button.

2. Nothing is committed yet.

## What was wrong

### Wrong numbers

| #   | Problem                                                                                             | Cause                                                                             |
| --- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 1   | Late payments were never counted. The health score ignored them, and late rows showed "مستحقة".     | The page counted `status = 'overdue'`, which nothing in the app ever writes.      |
| 2   | "مستحقات غير محصّلة" included future instalments.                                                   | It summed every unpaid row, whatever the due date.                                |
| 3   | "العائد %" grew every year.                                                                         | All-time net income divided by the current yearly rent.                           |
| 4   | "إجمالي الإيجارات السنوية" counted sold and vacant units.                                           | It summed `annual_rent` across all units.                                         |
| 5   | "آخر المدفوعات" showed future instalments first.                                                    | It was sorted by due date, newest first.                                          |
| 6   | Leases that had ended but were still marked active were hidden.                                     | The filter was `days >= 0`.                                                       |
| 7   | A unit owned directly inside someone else's property was invisible, yet its payments still counted. | The page queried `FROM properties`, and owners can only read properties they own. |
| 8   | Failed queries rendered as zeros.                                                                   | Query errors were ignored.                                                        |
| 9   | Totals were silently cut off for large portfolios.                                                  | Client-side sums over at most 1,000 rows.                                         |
| 10  | A new owner with no units scored 60 with "needs attention".                                         | Occupancy of 0% was treated as bad.                                               |

### Data scoping and access

- **Owners who are also tenants saw mixed data.** Their own tenant payments and maintenance were mixed into the owner totals. They also got the tenant menu, with no link to the owner dashboard.
- **The office card and PDF letterhead used an arbitrary office.** They took the oldest office the user could read, or showed none for owners linked only through a property or an agreement.
- **The market report covered every district** of every linked office, not the owner's own.
- **Property owners never received maintenance approvals.** The office screen only checked `units.owner_id`.
- **Staff users could read every office's settings row,** including VAT and CR numbers and rates.
- **Agreements used the wrong owner.** A property owner could sign a management agreement over a unit owned by someone else, and that unit's owner couldn't sign one. The owner audit-log policy had the same flaw.

### Design

- Five KPI cards in one row cut SAR amounts off with "…".
- The section order was backwards: the office card came first and approvals were buried.
- Late payments looked identical to due ones.
- Unit cards didn't show the property name.
- The chart had no Y axis, no empty state, and values only on hover.
- Nav links could land on sections that weren't rendered.
- Day counts weren't pluralised ("بعد 5 يوم").
- The "كشف حساب" PDF was just a unit list.
- Month labels could render in the Hijri calendar.

## What was fixed

### Database

- **`20261003120000_owner_dashboard_scoped_rpcs.sql`** adds five owner-scoped functions. Ownership is `COALESCE(units.owner_id, properties.owner_id)`, the same rule as `private.unit_owner()`.
  - `owner_units()` — the caller's units, with property and active-lease details.
  - `owner_finance_summary()` — late payments, upcoming 30 days, collected and expenses over the last 12 months, the last 6 months by month, and recent payments up to today. Dates are in Riyadh time.
  - `owner_property_returns()` — net income per property over the last 12 months, and its % of yearly rent.
  - `owner_pending_approvals()` — pending maintenance on the caller's own units only.
  - `owner_offices()` — the offices managing the caller's units: each property's office plus offices with an active agreement.
  - The storage policy for office logos now also allows those offices.
- **`20261004100000_owner_access_fixes.sql`**:
  - `org_settings` can only be read by members of that office.
  - `request_management_agreement` and `audit_log_owner_read` use the unit-or-property owner rule.
  - Backfill: requests that skipped approval and haven't started yet go back to `pending`.

### Front end

- **`owner-dashboard.tsx`, rebuilt on the new functions:**
  - section order: approvals → KPIs → health → expiring leases → finance → reports → units grouped by property → offices;
  - error and empty states;
  - approval rows show the description, priority and date; rejecting asks for confirmation and takes an optional note;
  - the chart has a Y axis, values on the bars and an empty state;
  - dates are always Gregorian;
  - the PDF is a real 12-month statement.
- **`maintenance.tsx`:** approval is needed when the unit is owned through its property too.
- **`app-shell.tsx`:** owner+tenant accounts get the right menu with a switch link, and the approvals badge only counts requests the user can approve.
- **`owner.agreements.tsx`:** the unit picker uses `owner_units()`.
- **`use-org-branding.ts`:** new reusable `useBrandingLogo()` hook.
- **`format.ts`:** new `daysLabel()` for Arabic day counts, with tests.

### Verification

- Type-check, lint, the 143 unit tests and the production build all pass.
- Both migrations ran in PGlite against seed data built to hit each bug: 33 checks, all passing.
- **Not done:** running against the real database, and viewing the dashboard in a browser.

## Migration folder (open)

The live database is fine, but `supabase/migrations` can't be replayed from scratch. It has:

- 5 identical file pairs;
- 4 version numbers each used by two files;
- 8 hand-written files that Lovable re-saved under its own name.

This needs database access to fix. See `supabase/BASELINE.md` and `scripts/migrations/`:

- `node scripts/migrations/report.mjs` — read-only report; `--strict` fails while duplicates exist.
- `scripts/migrations/baseline.sh` — export, then either:
  - **Route A (recommended):** a bootstrap file for new databases, leaving Lovable's folder untouched;
  - **Route B:** replace the folder, only after confirming with Lovable how it tracks applied migrations.

## Deliberately not changed

- **Requests already in progress or done** that skipped approval stay as they are.
- **Partial payments:** nothing in the app ever records a payment as partial, so there's nothing to fix.
- **The old `owner_property_roi()`** is unchanged, because `/portal` still uses it.

## Redesign (2026-10-04)

The page was rebuilt as components in `src/components/owner-dashboard/`. The route
(`src/routes/_authenticated/owner-dashboard.tsx`) now only handles fetching, decisions and the PDF
download.

### Reading order

The section ids match the owner nav links.

1. **Ink hero.** One hero figure, net income over the last 12 months, followed by the collected −
   expenses breakdown. Beside it: occupancy with a meter, late payments, and the amount due in the
   next 30 days. Actions: message the office, and the statement PDF.
2. **`#approvals` — "يحتاج انتباهك".** A single ranked list with the portfolio health score as its
   header.
   - Rows: approvals, late rent, leases that expired or end within 60 days, and vacant units.
   - Each row has a severity shown three ways (icon, word and coloured edge) and one next step.
   - Approving and rejecting both open a confirmation dialog showing the cost, with an optional
     note for the office.
3. **`#finance`.**
   - Monthly collections chart: ink bars, with the current month in red as the only accent.
   - Only the current and best months carry labels; the chart also has a tooltip and a table view.
   - Time runs right-to-left.
   - Next to it, recent payments.
4. **`#units`.** One card per property: occupancy meter, net income and % of yearly rent, expenses,
   then every unit with its status, rent and lease end. Cards use a masonry layout.
5. **`#reports`.** Your asking rent against each district's average (two bars on one scale,
   neutral colours), and the managing offices.

### Rules applied

- **Brand.** Sharp corners, flat stone panels, ink, and red only for primary actions and the
  current-month accent. The stock red progress bar was replaced by an ink meter.
- **Numbers.**
  - Arabic-Indic digits throughout, so counts and percentages match the money figures.
  - Correct Arabic agreement: `arCount` and `arPct` in `src/lib/format.ts`.
  - Money is never cut off.
- **Chart.**
  - Colours checked with the dataviz validator against both card surfaces: colourblind separation
    ΔE ≥ 27, contrast ≥ 3:1.
  - No bar animation: it replays on every refresh and delays the labels.
- **Calculations.** All derived numbers come from one pure function (`deriveDashboard` in
  `model.ts`), unit-tested against a realistic fixture
  (`src/lib/__testutils__/owner-dashboard-fixture.ts`).

### Verified

- Rendered in headless Chrome at 390, 768, 1024 and 1440px, in each state: full, all clear, no
  units, loading and error.
- No horizontal overflow in any of them, and no clipped money.
- Type-check, lint, 154 tests and the production build all pass.

## Redesign v2: navigation, renewals, map and nearby (2026-10-08)

### New

- **Sticky section tabs** under the hero follow the reader through the page. They mark the section
  in view and show the to-do count. The sidebar gains "الخريطة والجوار" (`#map`).
- **Hero.**
  - Greeting with the date, and the managing office(s).
  - Net margin next to net income.
  - Contracted yearly rent and rent up for renewal in the next 12 months.
  - A "أهم ما ينتظرك" strip that names the first item on the to-do list and links to it.
- **يحتاج انتباهك.** The health score moved to a side panel. Its factors (approvals, late rent,
  leases, vacancies) show their totals and filter the list.
- **التجديدات القادمة** (`renewals.tsx`, in `#finance`).
  - One column per month for 12 months, sized by the yearly rent of the leases ending that month.
  - Leases that have expired but are still active come first, in red and labelled "منتهية".
  - Choosing a month lists its units, each with a next step.
- **عقاراتي.**
  - Filter units by status and search by unit, property, type or district.
  - Switch between cards and a table.
  - Each property card gets a strip with one square per unit, and a "على الخريطة" button.
- **الخريطة والجوار** (`locations.tsx`, `#map`).
  - Uses the same occupancy map as `/map` (`units-map.tsx`, which gained optional selection and
    nearby-place props; `/map` itself is unchanged).
  - Choosing a property flies the map to it and shows the schools, mosques and markets within
    1.5 km, nearest first, with distances.
  - On the map, nearby places are squares and properties are circles, because the two colour sets
    overlap.

### Fixed along the way

- **Nearby places were always empty**, on the public listing page too. Overpass now answers 406 to
  requests without a descriptive `User-Agent`, and `nearbyPlaces` turned that into an empty list.
  The request now sends a `User-Agent`.

### Verified

- Rendered the fixture in headless Chrome at 1366px (light and dark) and at 390px.
- Tested choosing a property, which loaded live nearby places, and the table view.
- Type-check, the new model tests and the production build pass.
- Not done: viewing it with a real owner account.

## Owner features (2026-10-08)

All database changes are in `20261008120000_owner_features.sql`. Ownership is always
`private.unit_owner()`.

### What the owner can now do

- **Decide on renewals.**
  - In "التجديدات القادمة", each lease gets "حدّد قرارك": renew at the same rent, renew at a new
    rent, or don't renew, with an optional note.
  - The tenant's own decision (`renewal_requests`) is shown next to it. Only the decision is
    shown, not the tenant's note, which was written to the office.
  - A badge counts leases ending within 90 days that have no decision yet.
  - Stored in `owner_renewal_decisions` through `owner_submit_renewal_decision()`.
    - Only the owner of an active lease can submit.
    - A new decision supersedes the open one, so there is one open decision per lease.
    - Owners can't write the table directly.
    - Staff can only change `status`, within their own office.
  - `submitOwnerRenewalDecision` notifies the office's staff.
  - The office sees the decisions in a new "قرارات الملاك في التجديد" card on `/renewals`, with
    "تمت معالجته".
- **Auto-approve small maintenance.**
  - `/owner/settings` has a new "الموافقة التلقائية على الصيانة" card, stored in
    `owner_preferences.auto_approve_limit`.
  - It is enforced in the database: the `zz_owner_auto_approve` trigger runs after the other
    BEFORE triggers. A request set to `pending` at or under the limit becomes `approved`, with a
    note, and the owner is notified.
  - The approvals panel shows the current limit and links to the setting.
- **Act on vacant units.** "وحداتك الشاغرة" sits at the top of `#units` (`owner_vacancies()`):
  - days vacant, and the rent lost so far (asking ÷ 365 × days, rounded to 100);
  - the asking rent against similar units, meaning the same type, district and office, averaged
    only over 3 or more so no single unit's rent is revealed;
  - advice: lower it if more than 5% above similar units and vacant 30+ days, raise it if more
    than 10% below, otherwise hold (`rentAdvice`, unit-tested);
  - whether the public can see it (`vacant_units_public`), and if so a "شاهد إعلانك" link to
    `/unit/$unitId`;
  - "اطلب التعديل", which sends the office the new rent through `requestVacantRentChange`. The
    office still sets the price.
- **See money ahead and where it went.**
  - "التدفق المتوقع" (`owner_cashflow_forecast()`) shows what falls due each month for 6 months:
    collected in solid ink, the rest outlined, with totals.
  - "المصروفات حسب البند" (`owner_expenses_12m()`) groups 12 months of expenses by category
    (blank → "أخرى") and lists the latest items.
- **Export to Excel.** The header has an Excel button that builds a workbook with six sheets:
  summary, units, returns by property, recent payments, expenses and forecast. `xlsx` is loaded
  only on click.

### New owner notifications

- A maintenance cost waiting for the owner's approval. Before, nothing told them.
- Maintenance approved automatically under their limit.
- The tenant's renewal decision.

The notifications page now has labels for `lease`, `unit`, `payment_reminder` and `deal`.

### Not built

- **Neighbourhood rent on the map:** there is no district boundary or centroid data to draw it.
- **Email or WhatsApp alerts to owners:** the app has no transactional email sender apart from
  auth emails, and WhatsApp goes out through each office's channel. Owner alerts are in-app.
- **Expense receipts:** `expenses` has no attachment column.

### Verified

- Migration applied in PGlite with stubs of the tables and helpers it depends on: 29 checks pass.
  They cover RLS for every role, auto-approval and its notifications, renewal decisions, office
  isolation, forecast, expenses and vacancy peers.
- Model tests: 22 in `model.test.ts`. The whole suite has 167 tests, and they pass.
- Type-check, lint on changed files and the production build pass.
- Rendered the fixture in headless Chrome, including both new dialogs.
- Not done: running against the real database, or with real owner and office accounts.
