/** Shared by /audit (office-scoped, RLS) and /hq's per-subscriber feed (cross-office, service-role)
 * — both render the same audit_log row shape, so the labels and summary picker live here once. */

import {
  leaseStatusLabel,
  maintenanceStatusLabel,
  paymentStatusLabel,
  sar,
  shortDate,
  unitStatusLabel,
} from "@/lib/format";

export const tableLabel: Record<string, string> = {
  payments: "دفعة",
  leases: "عقد",
  maintenance_requests: "صيانة",
  units: "وحدة",
  expenses: "مصروف",
  deals: "صفقة",
  user_roles: "الدور",
};

export const actionLabel: Record<string, string> = {
  INSERT: "إضافة",
  UPDATE: "تعديل",
  DELETE: "حذف",
};

const summaryKeys = [
  "title",
  "amount",
  "annual_rent",
  "status",
  "full_name",
  "client_name",
  "name",
  "unit_number",
  "due_date",
  "category",
];

/** JSON-safe subset of jsonb — narrower than `unknown` so a server function can return this type
 * (TanStack Start's serializable-return check rejects `unknown`/`any` field types). */
export type AuditSummary = Record<string, string | number | boolean | null>;

export type AuditRow = {
  id: number;
  actor_id: string | null;
  table_name: string;
  row_id: string | null;
  action: string;
  summary: AuditSummary | null;
  created_at: string;
};

/** The stored status values are English; each table has its own vocabulary. */
const statusLabelByTable: Record<string, Record<string, string>> = {
  payments: paymentStatusLabel,
  leases: leaseStatusLabel,
  maintenance_requests: maintenanceStatusLabel,
  units: unitStatusLabel,
};

/** Values seen across tables, for a row whose table has no map of its own (or none was given). */
const anyStatusLabel: Record<string, string> = {
  pending: "قيد الانتظار",
  approved: "معتمد",
  rejected: "مرفوض",
  ended: "منتهي",
  ...unitStatusLabel,
  ...maintenanceStatusLabel,
  ...leaseStatusLabel,
  ...paymentStatusLabel,
};

const moneyKeys = new Set(["amount", "annual_rent"]);
const dateKeys = new Set(["due_date"]);

function formatValue(key: string, value: string | number | boolean, table?: string) {
  if (moneyKeys.has(key) && Number.isFinite(Number(value))) return sar(Number(value));
  if (dateKeys.has(key) && typeof value === "string") return shortDate(value);
  if (key === "status" && typeof value === "string") {
    return (table && statusLabelByTable[table]?.[value]) ?? anyStatusLabel[value] ?? value;
  }
  return `${value}`;
}

/** Up to four readable fields of the changed row: Arabic statuses, amounts in riyals, dates. */
export function summarize(summary: AuditSummary | null, table?: string) {
  if (!summary || typeof summary !== "object") return "";
  return summaryKeys
    .filter((k) => summary[k] !== null && summary[k] !== undefined && summary[k] !== "")
    .map((k) => formatValue(k, summary[k]!, table))
    .slice(0, 4)
    .join(" · ");
}
