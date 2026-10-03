import type { SupabaseClient } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export const LISTING_MEDIA_BUCKET = "listing-media";
export const MAX_UNIT_PHOTOS = 8;
/** Raw files may be large phone photos; they are shrunk before upload (see compressImage). */
export const MAX_RAW_IMAGE_BYTES = 25 * 1024 * 1024;
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Public URL of a file in the listing-media bucket. */
export function mediaUrl(path: string): string {
  return supabase.storage.from(LISTING_MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Public URL of an office logo in the branding bucket. */
export function brandingUrl(path: string): string {
  return supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
}

/** An Arabic error message when the file cannot be used, otherwise null. */
export function validateImageFile(file: { type: string; size: number }): string | null {
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type))
    return "الصيغة غير مدعومة — استخدم JPG أو PNG أو WebP";
  if (file.size > MAX_RAW_IMAGE_BYTES) return "الصورة كبيرة جدًا (الحد 25 ميجابايت)";
  if (file.size === 0) return "الملف فارغ";
  return null;
}

/** A photo in the editor: either already saved (`id` + `path`) or a new local file. */
export type PhotoItem = {
  key: string;
  id: string | null;
  path: string | null;
  file: File | null;
  preview: string;
};

export type ExistingPhoto = { id: string; path: string; position: number };

export type PhotoSyncPlan = {
  /** Saved photos the user removed. */
  toDelete: ExistingPhoto[];
  /** New files, with the position they were given in the editor. */
  toInsert: { key: string; position: number }[];
  /** Saved photos whose order changed. */
  toMove: { id: string; position: number }[];
};

/** What has to change in the database so that it matches the editor (position = index in the list). */
export function planPhotoSync(
  existing: ExistingPhoto[],
  desired: { key: string; id: string | null }[],
): PhotoSyncPlan {
  const keep = new Set(desired.map((d) => d.id).filter((id): id is string => id !== null));
  const byId = new Map(existing.map((p) => [p.id, p]));
  const toDelete = existing.filter((p) => !keep.has(p.id));
  const toInsert: PhotoSyncPlan["toInsert"] = [];
  const toMove: PhotoSyncPlan["toMove"] = [];
  desired.forEach((d, position) => {
    if (d.id === null) toInsert.push({ key: d.key, position });
    else if (byId.get(d.id)?.position !== position) toMove.push({ id: d.id, position });
  });
  return { toDelete, toInsert, toMove };
}

/**
 * Re-encode as JPEG no larger than `maxDim` on the longest side (browser only). Phone photos are
 * 3-12 MB; this makes them ~200-500 KB, which is what a listing page should load. EXIF rotation is
 * applied, and transparency is flattened onto white.
 */
export async function compressImage(file: File, maxDim = 1600, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("تعذّر معالجة الصورة");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (!blob) throw new Error("تعذّر معالجة الصورة");
  return blob;
}

/** Upload one already-compressed image and return its path inside the bucket. */
export async function uploadListingImage(
  client: SupabaseClient<Database>,
  folder: string,
  blob: Blob,
): Promise<string> {
  const path = `${folder}/${crypto.randomUUID()}.jpg`;
  const { error } = await client.storage
    .from(LISTING_MEDIA_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000" });
  if (error) throw new Error("تعذّر رفع الصورة — تأكد أن لديك صلاحية الموظف وحاول مرة أخرى");
  return path;
}

/**
 * Make the database match the editor: upload new photos, then insert/re-order rows, then delete the
 * removed ones (so a failure part-way never loses a photo that was kept). Files uploaded by a failed
 * run are removed again.
 */
export async function syncUnitPhotos(
  client: SupabaseClient<Database>,
  unitId: string,
  existing: ExistingPhoto[],
  desired: PhotoItem[],
): Promise<void> {
  const plan = planPhotoSync(existing, desired);
  const byKey = new Map(desired.map((d) => [d.key, d]));
  const uploaded: string[] = [];

  try {
    const rows: { unit_id: string; path: string; position: number }[] = [];
    for (const item of plan.toInsert) {
      const file = byKey.get(item.key)?.file;
      if (!file) continue;
      const path = await uploadListingImage(client, unitId, await compressImage(file));
      uploaded.push(path);
      rows.push({ unit_id: unitId, path, position: item.position });
    }
    if (rows.length > 0) {
      const { error } = await client.from("unit_photos").insert(rows);
      if (error) throw new Error("تعذّر حفظ الصور");
    }
    for (const move of plan.toMove) {
      const { error } = await client
        .from("unit_photos")
        .update({ position: move.position })
        .eq("id", move.id);
      if (error) throw new Error("تعذّر حفظ ترتيب الصور");
    }
  } catch (e) {
    if (uploaded.length > 0) {
      await client.storage.from(LISTING_MEDIA_BUCKET).remove(uploaded);
    }
    throw e;
  }

  if (plan.toDelete.length > 0) {
    const { error } = await client
      .from("unit_photos")
      .delete()
      .in(
        "id",
        plan.toDelete.map((p) => p.id),
      );
    if (error) throw new Error("تعذّر حذف الصور");
    // Best effort: an orphaned file is harmless, a failed cleanup must not fail the save.
    await client.storage.from(LISTING_MEDIA_BUCKET).remove(plan.toDelete.map((p) => p.path));
  }
}
