import { supabase } from "@/integrations/supabase/client";
import { todayRiyadh } from "@/lib/dates";
import { arCount, daysLabel, daysUntil, sar } from "@/lib/format";
import { portfolioHealthScore, type PortfolioHealth } from "@/lib/portfolio-health";

// Every list below comes from owner-scoped RPCs (supabase/migrations/20261003120000_*): they cover
// exactly the units the caller owns — COALESCE(units.owner_id, properties.owner_id) — so a dual
// owner+tenant account never mixes its own tenancy in, a unit owned inside someone else's property
// still counts, and totals are summed in the database instead of over a 1000-row client page.

export type OwnerUnit = {
  unit_id: string;
  unit_number: string;
  unit_type: string;
  status: string;
  annual_rent: number;
  property_id: string;
  property_name: string;
  city: string | null;
  district: string | null;
  lease_id: string | null;
  lease_end_date: string | null;
  lease_annual_rent: number | null;
};

export type RecentPayment = {
  id: string;
  amount: number;
  due_date: string;
  paid_date: string | null;
  status: string;
  unit_number: string;
  property_name: string;
};

export type Finance = {
  today: string;
  overdue_count: number;
  overdue_total: number;
  upcoming_30_total: number;
  collected_12m: number;
  expenses_12m: number;
  months: { month: string; collected: number }[];
  recent: RecentPayment[];
};

export type Approval = {
  id: string;
  title: string;
  description: string | null;
  cost: number;
  priority: string;
  created_at: string;
  unit_number: string;
  property_name: string;
};

export type PropertyReturn = {
  property_id: string;
  property_name: string;
  units_count: number;
  annual_rent: number;
  collected_12m: number;
  expenses_12m: number;
  net_12m: number;
  net_pct: number;
};

export type Office = {
  id: string;
  company_name: string;
  fal_license_no: string | null;
  office_phone: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  logo_url: string | null;
  units_count: number;
};

export type MarketRow = {
  district: string | null;
  units_count: number;
  avg_rent: number;
  occupancy_pct: number;
};

export type PropertyLocation = { property_id: string; lat: number; lng: number };

export type RenewalDecisionRow = {
  lease_id: string;
  owner_decision: "renew" | "renew_new_rent" | "leave" | null;
  owner_proposed_rent: number | null;
  owner_note: string | null;
  owner_status: "new" | "handled" | null;
  owner_decided_at: string | null;
  tenant_decision: "renew" | "leave" | null;
  tenant_decided_at: string | null;
};

export type ForecastMonth = { month: string; due: number; paid: number };

export type ExpenseRow = {
  id: string;
  expense_date: string;
  title: string;
  category: string | null;
  amount: number;
  property_name: string | null;
  unit_number: string | null;
};

export type VacancyRow = {
  unit_id: string;
  vacant_since: string | null;
  market_listed: boolean;
  publicly_listed: boolean;
  photos_count: number;
  peer_avg_rent: number | null;
  peer_units: number;
};

export type OwnerDashboardData = {
  units: OwnerUnit[];
  finance: Finance;
  approvals: Approval[];
  returns: PropertyReturn[];
  offices: Office[];
  market: MarketRow[];
  /** Properties with known coordinates; the rest are simply left off the map. */
  locations: PropertyLocation[];
  // Supplementary (migration 20261008120000): null when unavailable, so a section is left out
  // rather than shown empty — "no expenses" must never be a network blip.
  renewalDecisions: RenewalDecisionRow[] | null;
  forecast: ForecastMonth[] | null;
  expenses: ExpenseRow[] | null;
  vacancies: VacancyRow[] | null;
  /** The owner's auto-approve limit for maintenance; null = always ask. */
  autoApproveLimit: number | null;
};

export async function loadOwnerDashboard(): Promise<OwnerDashboardData> {
  const [
    units,
    finance,
    approvals,
    returns,
    offices,
    market,
    renewalDecisions,
    forecast,
    expenses,
    vacancies,
    prefs,
  ] = await Promise.all([
    supabase.rpc("owner_units"),
    supabase.rpc("owner_finance_summary"),
    supabase.rpc("owner_pending_approvals"),
    supabase.rpc("owner_property_returns"),
    supabase.rpc("owner_offices"),
    supabase.rpc("market_stats"),
    supabase.rpc("owner_renewals"),
    supabase.rpc("owner_cashflow_forecast"),
    supabase.rpc("owner_expenses_12m"),
    supabase.rpc("owner_vacancies"),
    supabase.from("owner_preferences").select("auto_approve_limit").maybeSingle(),
  ]);
  // A failed query must surface as an error, not render as zeros — on a money screen "0 ر.س
  // متأخرات" after a network blip reads as a fact.
  const failed = [units, finance, approvals, returns, offices].find((r) => r.error);
  if (failed?.error) throw failed.error;

  const ownedUnits = (units.data ?? []) as unknown as OwnerUnit[];
  const f = (finance.data ?? {}) as Partial<Finance>;
  return {
    units: ownedUnits,
    finance: {
      today: f.today ?? "",
      overdue_count: Number(f.overdue_count ?? 0),
      overdue_total: Number(f.overdue_total ?? 0),
      upcoming_30_total: Number(f.upcoming_30_total ?? 0),
      collected_12m: Number(f.collected_12m ?? 0),
      expenses_12m: Number(f.expenses_12m ?? 0),
      months: (f.months ?? []).map((m) => ({ month: m.month, collected: Number(m.collected) })),
      recent: f.recent ?? [],
    },
    approvals: (approvals.data ?? []) as unknown as Approval[],
    returns: (returns.data ?? []) as unknown as PropertyReturn[],
    offices: (offices.data ?? []) as unknown as Office[],
    // The neighbourhood benchmark is supplementary: if it fails, the section is simply left out.
    market: market.error ? [] : ((market.data ?? []) as MarketRow[]),
    locations: await loadLocations(ownedUnits),
    renewalDecisions: renewalDecisions.error
      ? null
      : ((renewalDecisions.data ?? []) as RenewalDecisionRow[]),
    forecast: forecast.error
      ? null
      : (forecast.data ?? []).map((m) => ({
          month: m.month,
          due: Number(m.due),
          paid: Number(m.paid),
        })),
    expenses: expenses.error
      ? null
      : (expenses.data ?? []).map((e) => ({ ...e, amount: Number(e.amount) })),
    vacancies: vacancies.error
      ? null
      : (vacancies.data ?? []).map((v) => ({
          ...v,
          photos_count: Number(v.photos_count),
          peer_units: Number(v.peer_units),
          peer_avg_rent: v.peer_avg_rent === null ? null : Number(v.peer_avg_rent),
        })),
    autoApproveLimit:
      prefs.data?.auto_approve_limit == null ? null : Number(prefs.data.auto_approve_limit),
  };
}

/**
 * The map is supplementary, like the market benchmark: a failure leaves it out, never the page.
 * owner_property_locations() (migration 20261008100000) covers every property holding one of the
 * caller's units; until it is applied, fall back to the properties RLS already lets an owner read
 * (the ones they own outright).
 */
async function loadLocations(units: OwnerUnit[]): Promise<PropertyLocation[]> {
  if (units.length === 0) return [];
  const rpc = await supabase.rpc("owner_property_locations");
  if (!rpc.error) return (rpc.data ?? []).map(toLocation);

  const ids = [...new Set(units.map((u) => u.property_id))];
  const direct = await supabase
    .from("properties")
    .select("id, lat, lng")
    .in("id", ids)
    .not("lat", "is", null)
    .not("lng", "is", null);
  if (direct.error) return [];
  return (direct.data ?? []).map((p) =>
    toLocation({ property_id: p.id, lat: p.lat!, lng: p.lng! }),
  );
}

function toLocation(p: { property_id: string; lat: number; lng: number }): PropertyLocation {
  return { property_id: p.property_id, lat: Number(p.lat), lng: Number(p.lng) };
}

/* ----------------------------------------------------------------------------------------------
 * Derived view model — pure, so every number on the page is unit-tested in one place.
 * -------------------------------------------------------------------------------------------- */

export type Severity = "critical" | "warning" | "info";

export type AttentionItem =
  | { kind: "approval"; key: string; severity: Severity; approval: Approval }
  | { kind: "overdue"; key: string; severity: Severity; count: number; total: number }
  | { kind: "lease"; key: string; severity: Severity; unit: OwnerUnit; days: number }
  | { kind: "vacant"; key: string; severity: Severity; units: OwnerUnit[] };

export type PropertyGroup = {
  id: string;
  name: string;
  city: string | null;
  district: string | null;
  units: OwnerUnit[];
  rentable: number;
  occupied: number;
  occupancyPct: number;
  returns: PropertyReturn | null;
  location: { lat: number; lng: number } | null;
};

export type DistrictBenchmark = {
  district: string;
  myUnits: number;
  myAvgRent: number;
  marketAvgRent: number;
  marketUnits: number;
  marketOccupancyPct: number;
  /** Your average asking rent vs the district's, in %; positive = above the district. */
  deltaPct: number;
};

export type ChartPoint = { key: string; collected: number; current: boolean };

/** One month of the renewal timeline: the active leases that end in it. */
export type RenewalMonth = {
  /** "YYYY-MM", or "expired" for leases already past their end date but still active. */
  key: string;
  rent: number;
  units: OwnerUnit[];
};

export type ExpenseCategory = { category: string; total: number; count: number };

export type ForecastPoint = { key: string; due: number; paid: number; current: boolean };

/**
 * What to do about a vacant unit's asking rent, against similar units (same type, district and
 * office). Advice only — the office sets the price.
 */
export type RentAdvice =
  | { kind: "unknown" }
  | { kind: "hold" }
  | { kind: "lower"; target: number }
  | { kind: "raise"; target: number };

export type VacancyInsight = {
  unit: OwnerUnit;
  daysVacant: number | null;
  publiclyListed: boolean;
  marketListed: boolean;
  photos: number;
  peerAvgRent: number | null;
  peerUnits: number;
  /** Asking vs peers, in %; positive = above. Null without a peer average. */
  deltaPct: number | null;
  advice: RentAdvice;
};

/** Asking more than this far above similar units, vacant this long, is worth lowering. */
export const LOWER_ABOVE_PCT = 5;
export const LOWER_AFTER_DAYS = 30;
/** Asking this far below similar units leaves money on the table. */
export const RAISE_BELOW_PCT = 10;

/** How far ahead the renewal timeline looks, in calendar months (current month included). */
export const RENEWAL_MONTHS = 12;

export type DashboardModel = {
  hasUnits: boolean;
  occupied: number;
  rentable: number;
  occupancyPct: number;
  net12m: number;
  contractedRent: number;
  properties: PropertyGroup[];
  attention: AttentionItem[];
  health: PortfolioHealth;
  benchmarks: DistrictBenchmark[];
  chart: ChartPoint[];
  chartTotal: number;
  unitsCount: number;
  /** Units per status (occupied, vacant, maintenance, sold…). */
  statusCounts: Record<string, number>;
  /** Net as a share of what was collected over 12 months, in %; null when nothing was collected. */
  netMarginPct: number | null;
  /** Expired-but-active leases first (if any), then one bucket per month, current month first. */
  renewals: RenewalMonth[];
  renewalsRent: number;
  /** Per lease: the owner's and the tenant's renewal decisions (null when unavailable). */
  renewalDecisions: Map<string, RenewalDecisionRow> | null;
  expenseCategories: ExpenseCategory[];
  expensesTotal: number;
  forecast: ForecastPoint[];
  /** Still to be collected over the forecast window (due − paid). */
  forecastOutstanding: number;
  vacancies: VacancyInsight[];
};

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
const KIND_ORDER: Record<AttentionItem["kind"], number> = {
  approval: 0,
  overdue: 1,
  lease: 2,
  vacant: 3,
};
/** How far ahead a lease end is worth flagging. */
export const LEASE_WINDOW_DAYS = 60;

export function deriveDashboard(
  data: OwnerDashboardData,
  // Injectable for tests; the page uses the Riyadh-pinned daysUntil.
  daysFromToday: (date: string) => number = daysUntil,
): DashboardModel {
  const { units, finance, approvals, returns } = data;

  const rentableUnits = units.filter((u) => u.status !== "sold");
  const occupied = rentableUnits.filter((u) => u.status === "occupied").length;
  const occupancyPct = rentableUnits.length
    ? Math.round((occupied / rentableUnits.length) * 100)
    : 0;

  const returnsById = new Map(returns.map((r) => [r.property_id, r]));
  const locationsById = new Map(
    data.locations.map((l) => [l.property_id, { lat: l.lat, lng: l.lng }]),
  );
  const groups = new Map<string, PropertyGroup>();
  for (const u of units) {
    const g = groups.get(u.property_id) ?? {
      id: u.property_id,
      name: u.property_name,
      city: u.city,
      district: u.district,
      units: [],
      rentable: 0,
      occupied: 0,
      occupancyPct: 0,
      returns: returnsById.get(u.property_id) ?? null,
      location: locationsById.get(u.property_id) ?? null,
    };
    g.units.push(u);
    if (u.status !== "sold") g.rentable += 1;
    if (u.status === "occupied") g.occupied += 1;
    groups.set(u.property_id, g);
  }
  const properties = [...groups.values()].map((g) => ({
    ...g,
    occupancyPct: g.rentable ? Math.round((g.occupied / g.rentable) * 100) : 0,
  }));

  // Leases ending within the window — and ones already past their end date but never renewed or
  // closed, which are the most urgent of all.
  const leases = units
    .filter((u): u is OwnerUnit & { lease_end_date: string } => !!u.lease_end_date)
    .map((u) => ({ unit: u, days: daysFromToday(u.lease_end_date) }))
    .filter((l) => l.days <= LEASE_WINDOW_DAYS);
  const vacant = units.filter((u) => u.status === "vacant");

  const attention: AttentionItem[] = [
    ...approvals.map((a): AttentionItem => ({
      kind: "approval",
      key: `approval-${a.id}`,
      severity: a.priority === "urgent" ? "critical" : "warning",
      approval: a,
    })),
    ...(finance.overdue_count > 0
      ? [
          {
            kind: "overdue",
            key: "overdue",
            severity: "critical",
            count: finance.overdue_count,
            total: finance.overdue_total,
          } satisfies AttentionItem,
        ]
      : []),
    ...leases.map((l): AttentionItem => ({
      kind: "lease",
      key: `lease-${l.unit.unit_id}`,
      severity: l.days < 0 ? "critical" : l.days <= 30 ? "warning" : "info",
      unit: l.unit,
      days: l.days,
    })),
    ...(vacant.length > 0
      ? [{ kind: "vacant", key: "vacant", severity: "info", units: vacant } satisfies AttentionItem]
      : []),
  ];
  // Within a severity: approvals (the owner's own decision) → money → leases (soonest first) →
  // vacancies.
  const leaseDays = (i: AttentionItem) => (i.kind === "lease" ? i.days : 0);
  attention.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      leaseDays(a) - leaseDays(b),
  );

  const health = portfolioHealthScore({
    occupancyPct,
    overdueCount: finance.overdue_count,
    pendingMaintenanceCount: approvals.length,
    expiringLeasesCount: leases.length,
  });

  // Like-for-like with market_stats(), which averages units.annual_rent (asking rent) by
  // COALESCE(unit district, property district) — owner_units() returns the same district key.
  const byDistrict = new Map<string, OwnerUnit[]>();
  for (const u of rentableUnits) {
    if (!u.district) continue;
    byDistrict.set(u.district, [...(byDistrict.get(u.district) ?? []), u]);
  }
  const benchmarks: DistrictBenchmark[] = data.market
    .filter(
      (m): m is MarketRow & { district: string } => !!m.district && byDistrict.has(m.district),
    )
    .map((m) => {
      const mine = byDistrict.get(m.district)!;
      const myAvgRent = mine.reduce((s, u) => s + Number(u.annual_rent), 0) / mine.length;
      const marketAvgRent = Number(m.avg_rent);
      return {
        district: m.district,
        myUnits: mine.length,
        myAvgRent: Math.round(myAvgRent),
        marketAvgRent,
        marketUnits: Number(m.units_count),
        marketOccupancyPct: Math.round(Number(m.occupancy_pct)),
        deltaPct: marketAvgRent
          ? Math.round(((myAvgRent - marketAvgRent) / marketAvgRent) * 100)
          : 0,
      };
    });

  const months = finance.months;
  const chart = months.map((m, i) => ({
    key: m.month,
    collected: m.collected,
    // The function returns the last 6 months oldest-first; the last bucket is the current,
    // still-running month.
    current: i === months.length - 1,
  }));

  const statusCounts: Record<string, number> = {};
  for (const u of units) statusCounts[u.status] = (statusCounts[u.status] ?? 0) + 1;

  return {
    hasUnits: units.length > 0,
    occupied,
    rentable: rentableUnits.length,
    occupancyPct,
    net12m: finance.collected_12m - finance.expenses_12m,
    contractedRent: units.reduce((s, u) => s + Number(u.lease_annual_rent ?? 0), 0),
    properties,
    attention,
    health,
    benchmarks,
    chart,
    chartTotal: chart.reduce((s, p) => s + p.collected, 0),
    unitsCount: units.length,
    statusCounts,
    netMarginPct: finance.collected_12m
      ? Math.round(((finance.collected_12m - finance.expenses_12m) / finance.collected_12m) * 100)
      : null,
    ...renewalTimeline(units, finance.today || todayRiyadh(), daysFromToday),
    renewalDecisions: data.renewalDecisions
      ? new Map(data.renewalDecisions.map((r) => [r.lease_id, r]))
      : null,
    ...expenseBreakdown(data.expenses ?? []),
    ...forecastPoints(data.forecast ?? []),
    vacancies: vacancyInsights(units, data.vacancies ?? [], finance.today || todayRiyadh()),
  };
}

/** Category label for an expense with none — matches the office reports. */
export const UNCATEGORISED = "أخرى";

function expenseBreakdown(rows: ExpenseRow[]) {
  const by = new Map<string, ExpenseCategory>();
  for (const e of rows) {
    const category = e.category?.trim() || UNCATEGORISED;
    const c = by.get(category) ?? { category, total: 0, count: 0 };
    c.total += e.amount;
    c.count += 1;
    by.set(category, c);
  }
  const expenseCategories = [...by.values()].sort((a, b) => b.total - a.total);
  return { expenseCategories, expensesTotal: rows.reduce((s, e) => s + e.amount, 0) };
}

function forecastPoints(months: ForecastMonth[]) {
  const forecast = months.map((m, i) => ({
    key: m.month,
    due: m.due,
    paid: m.paid,
    // The function returns this month first.
    current: i === 0,
  }));
  return {
    forecast,
    forecastOutstanding: forecast.reduce((s, p) => s + Math.max(0, p.due - p.paid), 0),
  };
}

/** Rounded to the nearest 500 SAR — a price an office would actually list. */
function round500(n: number) {
  return Math.round(n / 500) * 500;
}

export function rentAdvice(
  asking: number,
  peerAvg: number | null,
  daysVacant: number | null,
): RentAdvice {
  if (!peerAvg || !asking) return { kind: "unknown" };
  const delta = ((asking - peerAvg) / peerAvg) * 100;
  if (delta > LOWER_ABOVE_PCT && (daysVacant ?? 0) >= LOWER_AFTER_DAYS) {
    return { kind: "lower", target: round500(peerAvg) };
  }
  if (delta < -RAISE_BELOW_PCT) return { kind: "raise", target: round500(peerAvg) };
  return { kind: "hold" };
}

function vacancyInsights(units: OwnerUnit[], rows: VacancyRow[], today: string): VacancyInsight[] {
  const byId = new Map(rows.map((r) => [r.unit_id, r]));
  return (
    units
      .filter((u) => u.status === "vacant")
      .map((u) => {
        const v = byId.get(u.unit_id);
        const daysVacant = v?.vacant_since
          ? Math.max(
              0,
              Math.round(
                (Date.parse(`${today}T00:00:00Z`) -
                  Date.parse(`${v.vacant_since.slice(0, 10)}T00:00:00Z`)) /
                  86_400_000,
              ),
            )
          : null;
        const asking = Number(u.annual_rent);
        const peerAvg = v?.peer_avg_rent ?? null;
        return {
          unit: u,
          daysVacant,
          publiclyListed: v?.publicly_listed ?? false,
          marketListed: v?.market_listed ?? false,
          photos: v?.photos_count ?? 0,
          peerAvgRent: peerAvg,
          peerUnits: v?.peer_units ?? 0,
          deltaPct: peerAvg && asking ? Math.round(((asking - peerAvg) / peerAvg) * 100) : null,
          advice: rentAdvice(asking, peerAvg, daysVacant),
        };
      })
      // Longest-vacant first: that is where the money is being lost.
      .sort((a, b) => (b.daysVacant ?? -1) - (a.daysVacant ?? -1))
  );
}

/** "2026-10" plus n months → "2027-02". */
export function addMonths(key: string, n: number) {
  const [y, m] = key.split("-").map(Number) as [number, number];
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

function renewalTimeline(
  units: OwnerUnit[],
  today: string,
  daysFromToday: (date: string) => number,
): { renewals: RenewalMonth[]; renewalsRent: number } {
  const first = today.slice(0, 7);
  const buckets = new Map<string, RenewalMonth>();
  for (let i = 0; i < RENEWAL_MONTHS; i++) {
    const key = addMonths(first, i);
    buckets.set(key, { key, rent: 0, units: [] });
  }
  const expired: RenewalMonth = { key: "expired", rent: 0, units: [] };
  for (const u of units) {
    if (!u.lease_id || !u.lease_end_date) continue;
    const bucket =
      daysFromToday(u.lease_end_date) < 0 ? expired : buckets.get(u.lease_end_date.slice(0, 7));
    if (!bucket) continue; // beyond the window
    bucket.units.push(u);
    bucket.rent += Number(u.lease_annual_rent ?? 0);
  }
  const renewals = [...(expired.units.length ? [expired] : []), ...buckets.values()];
  return { renewals, renewalsRent: renewals.reduce((s, b) => s + b.rent, 0) };
}

/** One line naming an attention item — used by the hero's "first thing to do" strip. */
export function attentionHeadline(item: AttentionItem): string {
  switch (item.kind) {
    case "approval":
      return `${item.approval.title} — بانتظار موافقتك على ${sar(item.approval.cost)}`;
    case "overdue":
      return `متأخرات إيجار بإجمالي ${sar(item.total)}`;
    case "lease":
      return item.days < 0
        ? `عقد وحدة ${item.unit.unit_number} انتهى ولم يُجدَّد`
        : `عقد وحدة ${item.unit.unit_number} ينتهي بعد ${daysLabel(item.days)}`;
    case "vacant":
      return arCount(item.units.length, {
        one: "وحدة شاغرة تنتظر التسويق",
        two: "وحدتان شاغرتان تنتظران التسويق",
        few: "وحدات شاغرة تنتظر التسويق",
        many: "وحدة شاغرة تنتظر التسويق",
      });
  }
}

const YEAR = new Intl.NumberFormat("ar-SA", { useGrouping: false });

/** "2026-05" → "٢٠٢٦", in the same digits as every other number on the page. */
export function yearAr(key: string) {
  return YEAR.format(Number(key.slice(0, 4)));
}

/** "2026-05" → short Gregorian month name. Pinned to the Gregorian calendar: plain "ar-SA" can
 * resolve to the Hijri calendar and label Gregorian buckets with Hijri month names. */
export function monthLabel(key: string, month: "short" | "long" = "short") {
  return new Date(`${key}-15T00:00:00Z`).toLocaleDateString("ar-SA-u-ca-gregory", {
    month,
    timeZone: "UTC",
  });
}
