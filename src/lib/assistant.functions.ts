import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { enforceRateLimit } from "@/lib/rate-limit";
import { requireStaff, type ServerCtx } from "@/lib/server-context";
import { aiChatUrl, aiKey, aiModel } from "@/lib/ai.server";

const chatInput = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(20),
  mode: z.enum(["assistant", "listing", "whatsapp"]).default("assistant"),
});

const systemPrompts: Record<string, string> = {
  assistant:
    "أنت مساعد تشغيلي لمنصة إدارة أملاك سعودية. تجيب بالعربية بإيجاز ووضوح عن الإشغال والتحصيل والمتأخرات والصيانة والعقود، وتقترح إجراءات عملية محددة (من نُطالب، ما نرسل، ما نُسند لفني). لا تختلق أرقامًا؛ إن لم تتوفر البيانات اطلبها.",
  listing:
    "أنت كاتب إعلانات عقارية سعودي. اكتب إعلان تأجير عربي جاذب ومختصر (٤٠-٨٠ كلمة) يبرز الموقع والمساحة والغرف والسعر، بدون مبالغة أو وعود غير دقيقة، وأضف سطر دعوة للتواصل.",
  whatsapp:
    "أنت الطبقة الذكية لمساعد واتساب في نظام إدارة أملاك. حلّل رسالة المستأجر بالعامية أو الفصحى، وحدد النية (استفسار رصيد، تأكيد سداد، إبلاغ عطل، تجديد عقد، أخرى)، ثم أعد: 1) النية، 2) الإجراء المقترح داخل النظام، 3) نص الرد المناسب للمستأجر بالعربية. اجعل الإجابة قصيرة ومنظمة.",
};

/** Calls the shared AI key: office staff only, and limited per user (30 requests / 10 minutes). */
export const askAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => chatInput.parse(data))
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    await enforceRateLimit(ctx, "assistant", 30, 600);

    const apiKey = aiKey();
    if (!apiKey) throw new Error("AI غير مهيأ");

    const response = await fetch(aiChatUrl(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: aiModel(),
        messages: [
          { role: "system", content: systemPrompts[data.mode] ?? systemPrompts["assistant"] },
          ...data.messages,
        ],
      }),
    });

    if (!response.ok) {
      if (response.status === 429) throw new Error("تم تجاوز حد الاستخدام، جرّب بعد قليل");
      if (response.status === 402) throw new Error("رصيد الذكاء الاصطناعي غير كافٍ");
      throw new Error("تعذّر الحصول على رد من المساعد");
    }

    const json = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    return { reply: json.choices?.[0]?.message?.content ?? "" };
  });
