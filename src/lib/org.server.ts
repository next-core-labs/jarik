import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

type Admin = SupabaseClient<Database>;

/**
 * Helpers for server code that runs with the service role, which bypasses row-level security.
 * Anything done with the admin client must be scoped to an office explicitly with these.
 */

export type OrgOfTable =
  | "properties"
  | "units"
  | "leases"
  | "payments"
  | "tenants"
  | "maintenance_requests"
  | "unit_requests"
  | "whatsapp_channels";

/** The office a row belongs to. Throws when it cannot be determined. */
export async function orgOf(admin: Admin, table: OrgOfTable, id: string): Promise<string> {
  const { data, error } = await admin.rpc("org_of", { _table: table, _id: id });
  if (error || !data) throw new Error("تعذّر تحديد المكتب المعني بهذا الطلب");
  return data;
}

/** Ids of every account connected to an office (employees, linked clients, tenants, owners). */
export async function orgUserIds(admin: Admin, orgId: string): Promise<string[]> {
  const { data, error } = await admin.rpc("org_user_ids", { _org: orgId });
  if (error) throw error;
  return data ?? [];
}

/** Offices an account is connected to (as employee, client, tenant or owner). */
export async function orgsOfUser(admin: Admin, userId: string): Promise<string[]> {
  const { data, error } = await admin.rpc("orgs_of_user", { _uid: userId });
  if (error) throw error;
  return data ?? [];
}

/** Admin/staff accounts of ONE office, the people who should hear about its events. */
export async function staffIdsOfOrg(admin: Admin, orgId: string): Promise<string[]> {
  const { data: members, error } = await admin
    .from("org_members")
    .select("user_id")
    .eq("org_id", orgId);
  if (error) throw error;
  const ids = (members ?? []).map((m) => m.user_id);
  if (ids.length === 0) return [];
  const { data: roles, error: rolesError } = await admin
    .from("user_roles")
    .select("user_id")
    .in("user_id", ids)
    .in("role", ["admin", "staff"]);
  if (rolesError) throw rolesError;
  return [...new Set((roles ?? []).map((r) => r.user_id))];
}

/**
 * The office that receives a public request (e.g. "I could not find what I want"): the chosen office
 * if it is publicly listed and verified. A specific office that is not listed or verified yields null
 * (the visitor was looking at that office, so the request must not land with a different one); only a
 * request that names no office goes to the oldest listed office. Null if there is none.
 */
export async function resolvePublicOffice(
  admin: Admin,
  officeId?: string | null,
): Promise<string | null> {
  if (officeId) {
    const { data } = await admin
      .from("org_settings")
      .select("id")
      .eq("id", officeId)
      .eq("listed_publicly", true)
      .eq("verified", true)
      .maybeSingle();
    return data?.id ?? null;
  }
  const { data } = await admin
    .from("org_settings")
    .select("id")
    .eq("listed_publicly", true)
    .eq("verified", true)
    .order("created_at", { ascending: true })
    .limit(1);
  return data?.[0]?.id ?? null;
}
