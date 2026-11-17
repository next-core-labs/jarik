import { createFileRoute } from "@tanstack/react-router";

/**
 * تصريف صندوق تذكيرات التفعيل: pg_cron في Supabase ينادي هذه النقطة يوميًا (09:40 بالرياض، عشر
 * دقائق بعد notify_cold_offices) حاملًا السرّ في ترويسة x-cron-secret. Postgres لا يرسل بريدًا،
 * ومفتاح Resend والقوالب هنا — فالقاعدة تقرّر من يُذكَّر، وهذه النقطة ترسل فقط.
 *
 * السرّ مولَّد ومحفوظ في القاعدة (private.app_config)، والتحقّق عبر cron_secret_valid التي لا
 * تُعيد القيمة أبدًا. فلا متغيّر بيئة جديد ولا خطوة إعداد.
 *
 * كل سطر يُسجَّل بنتيجته: فشل مؤقّت يبقى pending ليُعاد غدًا، وبعد ثلاث محاولات يصير failed ويظهر
 * في لوحة التفعيل — فلا تذكير يفشل بصمت.
 */
export const Route = createFileRoute("/api/public/cron/office-reminders")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const resendKey = process.env["RESEND_API_KEY"];
        const provided = request.headers.get("x-cron-secret") ?? "";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        // التحقّق أولًا: لا نكشف شيئًا عن الحالة لمن لا يملك السرّ.
        if (provided.length < 16) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { data: valid, error: authError } = await supabaseAdmin.rpc("cron_secret_valid", {
          _secret: provided,
        });
        if (authError) {
          console.error("[cron/office-reminders] secret check failed", authError.message);
          return Response.json({ error: "internal error" }, { status: 500 });
        }
        if (!valid) return Response.json({ error: "unauthorized" }, { status: 401 });

        if (!resendKey) {
          console.error("[cron/office-reminders] missing RESEND_API_KEY");
          return Response.json({ error: "email not configured" }, { status: 500 });
        }

        // نفس المنطق الذي يستدعيه زر «أرسل الآن» في /hq — مكان واحد.
        try {
          const { drainReminderEmails } = await import("@/lib/reminder-emails.server");
          const result = await drainReminderEmails(supabaseAdmin, resendKey);
          return Response.json(result);
        } catch (e) {
          const message = e instanceof Error ? e.message : "drain failed";
          console.error("[cron/office-reminders]", message);
          return Response.json({ error: "internal error" }, { status: 500 });
        }
      },
    },
  },
});
