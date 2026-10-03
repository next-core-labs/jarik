// إرسال رسائل واتساب الصادرة عبر مزوّد المكتب (Meta WhatsApp Cloud أو Twilio) + تسجيلها في السجل.
// الواتساب مقفل افتراضيًا على المكاتب — الإدارة تفعّله من إعدادات هوية المكتب.

export const WHATSAPP_LOCKED_MSG = "الواتساب مقفل حاليًا — تواصل مع الإدارة لتفعيل الربط";

type SendResult = { sent: boolean; reason?: string };

/** هل ربط الواتساب مقفل على هذا المكتب؟ يقرأ المفتاح من إعداداته (افتراضيًا مقفل). */
export async function isWhatsappLocked(orgId: string): Promise<boolean> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("org_settings")
      .select("whatsapp_locked")
      .eq("id", orgId)
      .maybeSingle();
    return data?.whatsapp_locked !== false;
  } catch {
    return true;
  }
}

function digits(phone: string) {
  const only = phone.replace(/[^\d]/g, "");
  if (only.startsWith("966")) return only;
  if (only.startsWith("0")) return `966${only.slice(1)}`;
  if (only.length === 9) return `966${only}`;
  return only;
}

async function sendViaMeta(to: string, body: string): Promise<SendResult | null> {
  const phoneId = process.env["WHATSAPP_PHONE_NUMBER_ID"];
  const token = process.env["WHATSAPP_ACCESS_TOKEN"];
  if (!phoneId || !token) return null;

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { preview_url: false, body },
    }),
  });
  if (res.ok) return { sent: true };
  const text = await res.text();
  return { sent: false, reason: `Meta: ${res.status} ${text.slice(0, 200)}` };
}

async function sendViaTwilio(to: string, body: string): Promise<SendResult | null> {
  const sid = process.env["TWILIO_ACCOUNT_SID"];
  const token = process.env["TWILIO_AUTH_TOKEN"];
  const from = process.env["TWILIO_WHATSAPP_FROM"];
  if (!sid || !token || !from) return null;

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: `whatsapp:+${to}`,
      From: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
      Body: body,
    }),
  });
  if (res.ok) return { sent: true };
  const text = await res.text();
  return { sent: false, reason: `Twilio: ${res.status} ${text.slice(0, 200)}` };
}

/** حالة ربط واتساب المكتب (مقفل من الإدارة؟ وهل المزوّد مضبوط؟). */
export async function whatsappProviderStatus(orgId: string) {
  const locked = await isWhatsappLocked(orgId);
  if (process.env["WHATSAPP_PHONE_NUMBER_ID"] && process.env["WHATSAPP_ACCESS_TOKEN"]) {
    return {
      configured: true,
      provider: "meta" as const,
      locked,
      message: locked ? WHATSAPP_LOCKED_MSG : null,
    };
  }
  if (
    process.env["TWILIO_ACCOUNT_SID"] &&
    process.env["TWILIO_AUTH_TOKEN"] &&
    process.env["TWILIO_WHATSAPP_FROM"]
  ) {
    return {
      configured: true,
      provider: "twilio" as const,
      locked,
      message: locked ? WHATSAPP_LOCKED_MSG : null,
    };
  }
  return {
    configured: false,
    provider: null,
    locked,
    message: locked ? WHATSAPP_LOCKED_MSG : null,
  };
}

/** يرسل رسالة واتساب إن كان الربط مفعّلًا والمزوّد مضبوطًا، ويسجّلها في whatsapp_messages دائمًا. */
export async function sendWhatsappOut(input: {
  /** The office sending: its lock decides, and the message is logged against it. */
  orgId: string;
  phone: string;
  body: string;
  intent?: string | null;
  channelId?: string | null;
}): Promise<SendResult> {
  if (await isWhatsappLocked(input.orgId)) {
    return { sent: false, reason: WHATSAPP_LOCKED_MSG };
  }

  const to = digits(input.phone);
  let result: SendResult = { sent: false, reason: "لم يُضبط مزوّد واتساب بعد" };

  try {
    const meta = await sendViaMeta(to, input.body);
    if (meta) result = meta;
    else {
      const twilio = await sendViaTwilio(to, input.body);
      if (twilio) result = twilio;
    }
  } catch (e) {
    result = { sent: false, reason: (e as Error).message };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  await supabaseAdmin.from("whatsapp_messages").insert({
    phone: to,
    direction: "out",
    body: input.body,
    intent: input.intent ?? "رسالة صادرة",
    action_taken: result.sent ? "أُرسلت على واتساب" : `في الانتظار — ${result.reason ?? ""}`,
    channel_id: input.channelId ?? null,
    org_id: input.orgId,
  });

  return result;
}
