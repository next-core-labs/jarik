import { createFileRoute } from "@tanstack/react-router";

import { HookError, buildEmails, sendViaResend, verifyHook } from "@/lib/auth-email.server";

/**
 * Supabase → Authentication → Hooks → "Send Email" (HTTPS) points here:
 *   https://jarak-ksa.com/api/auth/send-email
 * Supabase expects 200 with an empty JSON object on success, or an error object it shows to the
 * user (sign-up / password reset then fails visibly instead of silently sending nothing).
 */
export const Route = createFileRoute("/api/auth/send-email")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["SEND_EMAIL_HOOK_SECRET"];
        const resendKey = process.env["RESEND_API_KEY"];
        const supabaseUrl = process.env["SUPABASE_URL"] || import.meta.env["VITE_SUPABASE_URL"];
        if (!secret || !resendKey || !supabaseUrl) {
          console.error(
            "[send-email] missing SEND_EMAIL_HOOK_SECRET, RESEND_API_KEY or SUPABASE_URL",
          );
          return Response.json(
            { error: { http_code: 500, message: "Email sending is not configured" } },
            { status: 500 },
          );
        }
        try {
          const payload = await verifyHook(await request.text(), request.headers, secret);
          for (const email of buildEmails(payload, supabaseUrl)) {
            await sendViaResend(email, resendKey, process.env["EMAIL_FROM"] || undefined);
          }
          return Response.json({});
        } catch (e) {
          const status = e instanceof HookError ? e.status : 500;
          const message = e instanceof Error ? e.message : "send failed";
          console.error("[send-email]", message);
          return Response.json({ error: { http_code: status, message } }, { status });
        }
      },
    },
  },
});
