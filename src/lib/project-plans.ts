import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";
import {
  compressImage,
  LISTING_MEDIA_BUCKET,
  photoFolder,
  uploadListingImage,
} from "@/lib/unit-photos";

/**
 * مخطط النموذج (floor plan): صورة واحدة لكل نموذج وحدة، تُحفظ في مجلّد المشروع نفسه
 * `projects/<project id>/` — وهذا ما يشترطه قيد project_models_plan_in_project_folder وما
 * يترجمه private.media_folder_org إلى مكتب المشروع في سياسة التخزين.
 */

/**
 * المخطط رسم خطّي فيه أرقام أبعاد، فضغطه بإعدادات صور العروض (1600px / 0.85) يُشوّش الأرقام.
 * هذه الإعدادات تحفظ قراءة الأبعاد وتبقي الحجم معقولًا.
 */
const PLAN_MAX_DIM = 2400;
const PLAN_QUALITY = 0.92;

/**
 * يرفع المخطط ثم يربطه بالنموذج. الترتيب مقصود: الرفع أولًا، فلو فشل التحديث بقي ملف يتيم (غير
 * ضار) بدل نموذج يشير إلى ملف غير موجود. مخطط سابق يُحذف بعد نجاح التحديث (أفضل جهد).
 */
export async function uploadModelFloorPlan(
  client: SupabaseClient<Database>,
  input: { projectId: string; modelId: string; file: File; previousPath: string | null },
): Promise<string> {
  const blob = await compressImage(input.file, PLAN_MAX_DIM, PLAN_QUALITY);
  const path = await uploadListingImage(
    client,
    photoFolder({ kind: "project", projectId: input.projectId }),
    blob,
  );

  const { error } = await client
    .from("project_models")
    .update({ floor_plan_path: path })
    .eq("id", input.modelId);
  if (error) {
    // تنظيف ما رُفع لتوّه حتى لا يتراكم ملف لا يشير إليه شيء.
    await client.storage.from(LISTING_MEDIA_BUCKET).remove([path]);
    throw new Error("تعذّر حفظ المخطط");
  }

  if (input.previousPath && input.previousPath !== path) {
    await client.storage.from(LISTING_MEDIA_BUCKET).remove([input.previousPath]);
  }
  return path;
}

/** يفصل المخطط عن النموذج ثم يحذف ملفه (أفضل جهد: ملف يتيم لا يُفشل العملية). */
export async function clearModelFloorPlan(
  client: SupabaseClient<Database>,
  input: { modelId: string; path: string | null },
): Promise<void> {
  const { error } = await client
    .from("project_models")
    .update({ floor_plan_path: null })
    .eq("id", input.modelId);
  if (error) throw new Error("تعذّر حذف المخطط");
  if (input.path) {
    await client.storage.from(LISTING_MEDIA_BUCKET).remove([input.path]);
  }
}
