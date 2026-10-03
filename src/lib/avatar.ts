import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export const AVATAR_BUCKET = "avatars";

/** Public URL of a file in the avatars bucket. */
export function avatarUrl(path: string): string {
  return supabase.storage.from(AVATAR_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Upload one already-compressed avatar image, inside the caller's own folder (storage policy only
 * allows writing under `<own uid>/...`). Returns its path inside the bucket. */
export async function uploadAvatar(
  client: SupabaseClient<Database>,
  userId: string,
  blob: Blob,
): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.jpg`;
  const { error } = await client.storage
    .from(AVATAR_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw new Error("تعذّر رفع الصورة");
  return path;
}
