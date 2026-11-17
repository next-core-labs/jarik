import { supabase } from "@/integrations/supabase/client";
import { uploadAvatar } from "@/lib/avatar";
import { myOrgId } from "@/lib/use-org-branding";
import { compressImage } from "@/lib/unit-photos";

/**
 * One picture for an office manager: the account photo («حسابي») and the office logo («بيانات
 * المكتب», shown in the office directory) are stored separately, so the manager used to upload the
 * same image twice. Whichever is uploaded first now also fills the other one when that one is still
 * empty — a later change to either never overwrites the other. Best effort: a failure here never
 * fails the upload the person made.
 */

/** After the account photo was saved: use it as the office logo if the office has none. */
export async function fillOfficeLogoIfEmpty(file: Blob): Promise<boolean> {
  try {
    const orgId = await myOrgId();
    if (!orgId) return false;
    const { data: isManager } = await supabase.rpc("is_office_manager");
    if (!isManager) return false;
    const { data: org } = await supabase
      .from("org_settings")
      .select("logo_url")
      .eq("id", orgId)
      .maybeSingle();
    if (!org || org.logo_url) return false;
    // The branding bucket only accepts files inside the office's own folder.
    const path = `${orgId}/logo-${Date.now()}.jpg`;
    const up = await supabase.storage
      .from("branding")
      .upload(path, file, { upsert: true, contentType: file.type || "image/jpeg" });
    if (up.error) return false;
    const { error } = await supabase
      .from("org_settings")
      .update({ logo_url: path })
      .eq("id", orgId)
      .is("logo_url", null);
    return !error;
  } catch (e) {
    console.error("[photo-sync] office logo not filled", e);
    return false;
  }
}

/** After the office logo was saved: use it as the manager's account photo if they have none. */
export async function fillAccountPhotoIfEmpty(file: File): Promise<boolean> {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return false;
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_path")
      .eq("id", userId)
      .maybeSingle();
    if (!profile || profile.avatar_path) return false;
    const blob = await compressImage(file, 512, 0.85);
    const path = await uploadAvatar(supabase, userId, blob);
    const { error } = await supabase
      .from("profiles")
      .update({ avatar_path: path })
      .eq("id", userId)
      .is("avatar_path", null);
    return !error;
  } catch (e) {
    console.error("[photo-sync] account photo not filled", e);
    return false;
  }
}
