import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import { staffIdsOfOrg } from "@/lib/org.server";

export type StaffNotice = {
  title: string;
  body: string;
  kind: string;
  related_table: string;
  related_id: string;
};

/**
 * Notify the admin/staff of ONE office. A notification failure must not fail the action that
 * triggered it, but it should not vanish silently either, so it is logged.
 */
export async function notifyStaff(
  supabaseAdmin: SupabaseClient<Database>,
  orgId: string,
  payload: StaffNotice,
): Promise<void> {
  let ids: string[];
  try {
    ids = await staffIdsOfOrg(supabaseAdmin, orgId);
  } catch (e) {
    console.error("[notifyStaff] could not load the office's staff:", (e as Error).message);
    return;
  }
  if (ids.length === 0) return;

  const { error } = await supabaseAdmin.from("notifications").insert(
    ids.map((id) => ({
      user_id: id,
      // The service role bypasses RLS, so nothing else would stamp the office on these rows, and
      // staff only ever see their own office's notifications.
      org_id: orgId,
      title: payload.title,
      body: payload.body,
      kind: payload.kind,
      source: "system",
      related_table: payload.related_table,
      related_id: payload.related_id,
    })),
  );
  if (error) console.error("[notifyStaff] insert failed:", error.message);
}
