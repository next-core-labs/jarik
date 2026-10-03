/** Shared by /audit (office-scoped, RLS) and /hq's per-subscriber feed (cross-office, service-role)
 * — both render the same audit_log row shape, so the labels and summary picker live here once. */

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

export function summarize(summary: AuditSummary | null) {
  if (!summary || typeof summary !== "object") return "";
  return summaryKeys
    .filter((k) => summary[k] !== null && summary[k] !== undefined && summary[k] !== "")
    .map((k) => `${summary[k]}`)
    .slice(0, 4)
    .join(" · ");
}
