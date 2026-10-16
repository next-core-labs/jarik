import { aiChatUrl, aiKey, aiModel } from "@/lib/ai.server";

// منطق تحويل رسالة واتساب إلى إجراء وإشعارات داخل المنصة — يُستخدم من السيرفر فقط

type Classification = {
  intent: string;
  sender_role: "owner" | "tenant" | "technician" | "unknown";
  title: string;
  summary: string;
  reply: string;
  priority: "low" | "medium" | "high" | "urgent";
  create_maintenance: boolean;
};

const CLASSIFY_PROMPT = `أنت الطبقة الذكية لمساعد واتساب في منصة إدارة أملاك سعودية.
تصلك رسالة من مالك أو مستأجر أو فني بالعامية أو الفصحى. أعد JSON فقط بهذا الشكل بدون أي نص إضافي:
{"intent":"استفسار رصيد|تأكيد سداد|إبلاغ عطل|تحديث حالة صيانة|تجديد عقد|استفسار عام",
"sender_role":"owner|tenant|technician|unknown",
"title":"عنوان قصير للإشعار داخل المنصة",
"summary":"سطر أو سطران يوضحان الطلب والإجراء المقترح",
"reply":"نص الرد المناسب للمرسل بالعربية",
"priority":"low|medium|high|urgent",
"create_maintenance":true أو false (صحيح فقط إذا كان إبلاغًا عن عطل يحتاج أمر صيانة)}`;

async function classify(body: string): Promise<Classification> {
  const apiKey = aiKey();
  const fallback: Classification = {
    intent: "استفسار عام",
    sender_role: "unknown",
    title: "رسالة واتساب جديدة",
    summary: body.slice(0, 200),
    reply: "وصلتنا رسالتك وسيتم التعامل معها.",
    priority: "medium",
    create_maintenance: false,
  };
  if (!apiKey) return fallback;

  const response = await fetch(aiChatUrl(), {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: aiModel(),
      messages: [
        { role: "system", content: CLASSIFY_PROMPT },
        { role: "user", content: body },
      ],
    }),
  });
  if (!response.ok) return fallback;

  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const raw = json.choices?.[0]?.message?.content ?? "";
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return fallback;
  try {
    return { ...fallback, ...(JSON.parse(match[0]) as Partial<Classification>) };
  } catch {
    return fallback;
  }
}

function normalizePhone(phone: string) {
  return phone.replace(/[^\d]/g, "").slice(-9);
}

const DUPLICATE_RESULT: Classification & { actionTaken: string; matchedName: string | null } = {
  intent: "مكررة",
  sender_role: "unknown",
  title: "",
  summary: "",
  reply: "",
  priority: "low",
  create_maintenance: false,
  actionTaken: "تم تجاهلها — رسالة مكررة سبق استلامها",
  matchedName: null,
};

export async function processIncomingWhatsapp(input: {
  /** The office that owns the channel the message came in on: everything below is scoped to it. */
  orgId: string;
  phone: string;
  body: string;
  channelId?: string | null;
  /** Meta message id / Twilio MessageSid, when the provider sends one — used to dedupe replayed
   * webhook deliveries. A provider that never sends one gets no replay protection. */
  providerMessageId?: string | null;
}) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { orgUserIds, staffIdsOfOrg } = await import("@/lib/org.server");

  // Claim this delivery before doing any other work: insert first, and a unique-constraint conflict
  // means this exact (channel, provider message id) was already processed, so skip everything below
  // instead of creating a second maintenance request / notification round for a replayed webhook.
  let messageRowId: string | null = null;
  if (input.providerMessageId && input.channelId) {
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from("whatsapp_messages")
      .insert({
        phone: input.phone,
        direction: "in",
        body: input.body,
        channel_id: input.channelId,
        provider_message_id: input.providerMessageId,
        org_id: input.orgId,
      })
      .select("id")
      .single();
    if (claimError) {
      if (claimError.code === "23505") return DUPLICATE_RESULT;
      throw new Error(claimError.message);
    }
    messageRowId = claimed.id;
  }

  const result = await classify(input.body);
  const tail = normalizePhone(input.phone);

  // مطابقة المُرسل داخل هذا المكتب فقط: مستأجر أولاً ثم أي حساب مرتبط بالمكتب برقم مطابق
  const { data: tenants } = await supabaseAdmin
    .from("tenants")
    .select("id, user_id, full_name, phone")
    .eq("org_id", input.orgId);
  const tenant = (tenants ?? []).find((t) => t.phone && normalizePhone(t.phone) === tail) ?? null;

  const officeUserIds = await orgUserIds(supabaseAdmin, input.orgId);
  const { data: profiles } =
    officeUserIds.length > 0
      ? await supabaseAdmin.from("profiles").select("id, full_name, phone").in("id", officeUserIds)
      : { data: [] as { id: string; full_name: string | null; phone: string | null }[] };
  const profile = (profiles ?? []).find((p) => p.phone && normalizePhone(p.phone) === tail) ?? null;

  let actionTaken = "إشعار داخلي للفريق";
  let maintenanceId: string | null = null;

  if (result.create_maintenance && tenant) {
    const { data: lease } = await supabaseAdmin
      .from("leases")
      .select("unit_id")
      .eq("tenant_id", tenant.id)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    const { data: created } = await supabaseAdmin
      .from("maintenance_requests")
      .insert({
        org_id: input.orgId,
        tenant_id: tenant.id,
        unit_id: lease?.unit_id ?? null,
        title: result.title,
        description: input.body,
        priority: result.priority,
        status: "new",
        source: "whatsapp",
      })
      .select("id")
      .maybeSingle();

    maintenanceId = created?.id ?? null;
    actionTaken = "أُنشئ طلب صيانة جديد";
  }

  // مستقبلو الإشعار: فريق هذا المكتب فقط + الحساب المطابق للمرسل إن وُجد
  const recipients = new Set<string>(await staffIdsOfOrg(supabaseAdmin, input.orgId));
  const senderUserId = tenant?.user_id ?? profile?.id ?? null;

  const senderName = tenant?.full_name ?? profile?.full_name ?? input.phone;
  const notifications = [...recipients].map((userId) => ({
    user_id: userId,
    org_id: input.orgId,
    title: `${result.intent}: ${result.title}`,
    body: `من ${senderName} (${input.phone})\n${result.summary}\nالإجراء: ${actionTaken}`,
    kind: result.create_maintenance ? "maintenance" : "message",
    source: "whatsapp",
    related_table: maintenanceId ? "maintenance_requests" : null,
    related_id: maintenanceId,
  }));

  let notificationId: string | null = null;
  if (notifications.length > 0) {
    const { data: inserted } = await supabaseAdmin
      .from("notifications")
      .insert(notifications)
      .select("id");
    notificationId = inserted?.[0]?.id ?? null;
  }

  if (senderUserId) {
    await supabaseAdmin.from("notifications").insert({
      user_id: senderUserId,
      org_id: input.orgId,
      title: "استلمنا رسالتك على واتساب",
      body: result.reply,
      kind: "reply",
      source: "whatsapp",
    });
  }

  const logFields = {
    intent: result.intent,
    sender_role: result.sender_role,
    suggested_reply: result.reply,
    action_taken: actionTaken,
    notification_id: notificationId,
  };
  if (messageRowId) {
    // The claim-insert above already wrote the row (and its dedup key) before this message was
    // processed — fill in the rest now instead of inserting a second row.
    await supabaseAdmin.from("whatsapp_messages").update(logFields).eq("id", messageRowId);
  } else {
    await supabaseAdmin.from("whatsapp_messages").insert({
      phone: input.phone,
      direction: "in",
      body: input.body,
      channel_id: input.channelId ?? null,
      org_id: input.orgId,
      ...logFields,
    });
  }

  return { ...result, actionTaken, matchedName: tenant?.full_name ?? profile?.full_name ?? null };
}
