import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * «أرسل الآن» في لوحة تفعيل المكاتب: يصرّف صندوق تذكيرات البريد فورًا بدل انتظار الـcron
 * (09:40 بالرياض). نفس منطق النقطة المجدولة بالضبط — فما يُجرَّب هنا هو ما يعمل تلقائيًا.
 *
 * الصلاحية: صاحب إذن «offices» في /hq فقط. والتحقّق يجري في القاعدة لا هنا: المتصل يُسأل عبر
 * is_hq_offices بصلاحياته هو، ثم يُصرَّف الصندوق بصلاحية الخدمة (البريد والمفتاح خارج متناول العميل).
 */
export const hqSendReminderEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // لا يُستخرج الإذن من العميل: الدالة المحمية في القاعدة هي من يقول إن له إذن «offices».
    const { data: allowed, error } = await context.supabase.rpc("is_hq_offices_me");
    if (error) throw new Error("تعذّر التحقّق من صلاحيتك");
    if (!allowed) throw new Error("غير مصرح");

    const resendKey = process.env["RESEND_API_KEY"];
    if (!resendKey) throw new Error("مفتاح البريد (RESEND_API_KEY) غير مضبوط على الخادم");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { drainReminderEmails } = await import("@/lib/reminder-emails.server");
    return await drainReminderEmails(supabaseAdmin, resendKey);
  });
