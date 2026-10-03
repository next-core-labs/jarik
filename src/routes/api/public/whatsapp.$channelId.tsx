import { createFileRoute } from "@tanstack/react-router";

type WhatsappMessage = { id?: string; from?: string; text?: { body?: string } };
/** Meta Cloud API shape, plus the flat `{ from, text }` shape used by simple/custom providers. */
type WhatsappJsonPayload = {
  entry?: { changes?: { value?: { messages?: WhatsappMessage[] } }[] }[];
  message?: WhatsappMessage;
  from?: string;
  phone?: string;
  text?: string;
  body?: string;
};

// نقطة استقبال رسائل واتساب لكل مكتب:
// https://<موقعك>/api/public/whatsapp/<معرّف القناة>?token=<رمز التحقق>
export const Route = createFileRoute("/api/public/whatsapp/$channelId")({
  staticData: { sitemap: false },
  server: {
    handlers: {
      // تحقق Meta من الرابط
      GET: async ({ request, params }) => {
        const { isValidChannelToken } = await import("@/lib/webhook-auth.server");
        const url = new URL(request.url);
        const token = url.searchParams.get("hub.verify_token");
        const challenge = url.searchParams.get("hub.challenge") ?? "";

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: channel } = await supabaseAdmin
          .from("whatsapp_channels")
          .select("id, verify_token, is_active")
          .eq("id", params.channelId)
          .maybeSingle();

        if (!channel || !channel.is_active || !isValidChannelToken(channel.verify_token, token)) {
          return new Response("forbidden", { status: 403 });
        }
        return new Response(challenge, { status: 200 });
      },

      POST: async ({ request, params }) => {
        const { isValidChannelToken, MAX_WEBHOOK_BODY_BYTES, MAX_WEBHOOK_TEXT_CHARS } =
          await import("@/lib/webhook-auth.server");

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: channel } = await supabaseAdmin
          .from("whatsapp_channels")
          .select("id, verify_token, is_active, provider, org_id")
          .eq("id", params.channelId)
          .maybeSingle();

        if (!channel || !channel.is_active) return new Response("forbidden", { status: 403 });

        const headerToken =
          request.headers.get("x-verify-token") ??
          new URL(request.url).searchParams.get("token") ??
          "";
        if (!isValidChannelToken(channel.verify_token, headerToken)) {
          return new Response("invalid token", { status: 401 });
        }

        const contentType = request.headers.get("content-type") ?? "";
        let phone = "";
        let body = "";
        let providerMessageId: string | null = null;

        try {
          // Read the raw body and measure it directly instead of trusting the client-supplied
          // Content-Length header — a request sent with no Content-Length (e.g. chunked transfer
          // encoding) would otherwise skip the size cap entirely before parsing.
          const rawText = await request.text();
          if (new TextEncoder().encode(rawText).length > MAX_WEBHOOK_BODY_BYTES) {
            return new Response("payload too large", { status: 413 });
          }

          if (contentType.includes("application/json")) {
            const payload = JSON.parse(rawText) as WhatsappJsonPayload | null;
            const metaMessage =
              payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0] ?? payload?.message ?? null;
            phone = metaMessage?.from ?? payload?.from ?? payload?.phone ?? "";
            body = metaMessage?.text?.body ?? payload?.text ?? payload?.body ?? "";
            providerMessageId = metaMessage?.id ?? null;
          } else {
            // Twilio-style webhooks send application/x-www-form-urlencoded, not multipart, so the
            // already-read text can be parsed directly without a second body read.
            const form = new URLSearchParams(rawText);
            phone = String(form.get("From") ?? form.get("from") ?? "").replace("whatsapp:", "");
            body = String(form.get("Body") ?? form.get("body") ?? "");
            providerMessageId = form.get("MessageSid") ?? form.get("SmsMessageSid") ?? null;
          }
        } catch {
          return new Response("bad request", { status: 400 });
        }

        phone = String(phone).slice(0, 32);
        body = String(body).slice(0, MAX_WEBHOOK_TEXT_CHARS);
        providerMessageId = providerMessageId ? providerMessageId.slice(0, 128) : null;
        if (!phone || !body) return new Response("ignored", { status: 200 });

        if (!channel.org_id)
          return new Response("channel not linked to an office", { status: 500 });

        const { processIncomingWhatsapp } = await import("@/lib/whatsapp.server");
        const result = await processIncomingWhatsapp({
          orgId: channel.org_id,
          phone,
          body,
          channelId: channel.id,
          providerMessageId,
        });

        return new Response(JSON.stringify({ ok: true, reply: result.reply }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
