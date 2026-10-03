import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/** Shared by admin-users.functions.ts and super-admin.functions.ts — both page through the same
 * service-role client the same way, so the pagination helpers live here once. */
export const PAGE = 1000;

/** Every auth user (listUsers is paginated; a single call silently drops everyone after the page). */
export async function listAllAuthUsers(admin: SupabaseClient<Database>) {
  const users = [];
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < PAGE) break;
  }
  return users;
}

/** Every row of a table read (PostgREST caps a single response at ~1000 rows). */
export async function fetchAllRows<T>(
  page: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}
