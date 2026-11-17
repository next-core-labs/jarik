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

        const { data: pending, error } = await supabaseAdmin.rpc("pending_reminder_emails", {
          _limit: 50,
        });
        if (error) {
          console.error("[cron/office-reminders] could not read the outbox", error.message);
          return Response.json({ error: "internal error" }, { status: 500 });
        }
        const rows = pending ?? [];
        if (rows.length === 0) return Response.json({ sent: 0, failed: 0, pending: 0 });

        const { OfficeActivationEmail } = await import("@/lib/email-templates/office-activation");
        const { SITE_NAME, SITE_URL, sendViaResend } = await import("@/lib/auth-email.server");
        const React = await import("react");

        let sent = 0;
        let failed = 0;
        for (const row of rows) {
          try {
            await sendViaResend(
              {
                to: row.to_email,
                subject: row.subject,
                element: React.createElement(OfficeActivationEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  title: row.subject.split(" — ")[0] ?? row.subject,
                  body: row.body,
                  officeName: row.company_name,
                  stage: Number(row.stage),
                }),
              },
              resendKey,
              process.env["EMAIL_FROM"] || undefined,
            );
            await supabaseAdmin.rpc("mark_reminder_email", { _id: row.id, _ok: true });
            sent += 1;
          } catch (e) {
            const message = e instanceof Error ? e.message : "send failed";
            // الفشل يُسجَّل على السطر نفسه، فلا يوقف بقية الصندوق.
            await supabaseAdmin.rpc("mark_reminder_email", {
              _id: row.id,
              _ok: false,
              _error: message,
            });
            failed += 1;
            console.error("[cron/office-reminders] send failed", row.id, message);
          }
        }

        return Response.json({ sent, failed, pending: rows.length - sent - failed });
      },
    },
  },
});
