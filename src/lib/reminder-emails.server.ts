import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/integrations/supabase/types";

/**
 * تصريف صندوق تذكيرات التفعيل. مشترك بين مسارين:
 *   • /api/public/cron/office-reminders — ينادِيه pg_cron يوميًا بالسرّ.
 *   • زر «أرسل الآن» في /hq — ليجرّب فريق المنصة الإرسال بلا انتظار الـcron.
 * منطق واحد، فما تجرّبه من اللوحة هو ما سيعمل تلقائيًا غدًا.
 */

export type DrainResult = { sent: number; failed: number; skipped: number };

export async function drainReminderEmails(
  client: SupabaseClient<Database>,
  resendKey: string,
  limit = 50,
): Promise<DrainResult> {
  const { data: pending, error } = await client.rpc("pending_reminder_emails", { _limit: limit });
  if (error) throw new Error("تعذّر قراءة صندوق البريد");
  const rows = pending ?? [];
  if (rows.length === 0) return { sent: 0, failed: 0, skipped: 0 };

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
            // العنوان في الصندوق هو «العنوان — اسم المكتب»؛ القالب يأخذ العنوان وحده.
            title: row.subject.split(" — ")[0] ?? row.subject,
            body: row.body,
            officeName: row.company_name,
            stage: Number(row.stage),
          }),
        },
        resendKey,
        process.env["EMAIL_FROM"] || undefined,
      );
      await client.rpc("mark_reminder_email", { _id: row.id, _ok: true });
      sent += 1;
    } catch (e) {
      const message = e instanceof Error ? e.message : "send failed";
      // الفشل يُسجَّل على السطر نفسه فلا يوقف بقية الصندوق، ويُعاد غدًا حتى ثلاث محاولات.
      await client.rpc("mark_reminder_email", { _id: row.id, _ok: false, _error: message });
      failed += 1;
      console.error("[reminder-emails] send failed", row.id, message);
    }
  }
  return { sent, failed, skipped: rows.length - sent - failed };
}
