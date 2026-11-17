import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

/**
 * «سجّل اهتمامك» في صفحة المشروع. لا يُشترى على الخارطة بضغطة: الزائر يترك اسمه ورقمه فيتواصل معه
 * مكتب المشروع. يُدرَج من الخادم بصلاحية الخدمة — نفس submitUnitRequest، فلا إدراج مباشر من
 * المتصفح على جدول يحمل بيانات تواصل، والمكتب يُستخرج من العرض العام لا من الطلب.
 */

/** أقصى تسجيلات اهتمام لنفس الرقم عند نفس المكتب خلال ساعة. */
const MAX_INTERESTS_PER_PHONE_PER_HOUR = 3;

export const submitProjectInterest = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z
      .object({
        projectId: z.guid(),
        /** النموذج الذي يهمّه، إن اختاره. يُتحقَّق من انتمائه للمشروع هنا لا في المتصفح. */
        modelId: z.guid().optional(),
        fullName: z.string().trim().min(2).max(120),
        phone: z
          .string()
          .trim()
          .regex(/^[0-9+\s-]{9,15}$/, "رقم جوال غير صحيح"),
        notes: z.string().trim().max(600).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");

    // المشروع يجب أن يكون منشورًا فعلًا (العرض العام)، ومكتبه يُقرأ منه لا من المتصفح.
    const { data: project, error: projectError } = await supabaseAdmin
      .from("projects_public")
      .select("id, name, office_id")
      .eq("id", data.projectId)
      .maybeSingle();
    if (projectError) throw new Error("تعذّر إرسال طلبك — حاول مرة أخرى");
    if (!project?.id || !project.office_id) {
      throw new Error("هذا المشروع لم يعد متاحًا — تصفّح المشاريع الأخرى");
    }
    const orgId = project.office_id;

    // نموذج من مشروع آخر يُهمَل بدل أن يُرفض الطلب كله.
    let modelId: string | null = null;
    let modelName: string | null = null;
    if (data.modelId) {
      const { data: model } = await supabaseAdmin
        .from("project_models_public")
        .select("id, name")
        .eq("id", data.modelId)
        .eq("project_id", project.id)
        .maybeSingle();
      modelId = model?.id ?? null;
      modelName = model?.name ?? null;
    }

    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("project_interests")
      .select("id", { count: "exact", head: true })
      .eq("phone", data.phone)
      .eq("org_id", orgId)
      .gte("created_at", since);
    if ((recent ?? 0) >= MAX_INTERESTS_PER_PHONE_PER_HOUR) {
      throw new Error("وصلتنا طلباتك خلال الساعة الماضية — سنتواصل معك قريبًا");
    }

    const { data: created, error } = await supabaseAdmin
      .from("project_interests")
      .insert({
        project_id: project.id,
        model_id: modelId,
        org_id: orgId,
        full_name: data.fullName,
        phone: data.phone,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error("تعذّر إرسال طلبك — حاول مرة أخرى");

    await notifyStaff(supabaseAdmin, orgId, {
      title: "تسجيل اهتمام بمشروع",
      body: `${data.fullName} — ${data.phone} · ${project.name}${modelName ? ` · ${modelName}` : ""}`,
      kind: "deal",
      related_table: "project_interests",
      related_id: created?.id ?? project.id,
    });

    return { ok: true as const };
  });
