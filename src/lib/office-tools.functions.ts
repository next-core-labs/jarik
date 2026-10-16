import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { classifyMaintenancePriority } from "@/lib/maintenance-triage";
import { getMyOrgId, requireStaff, type ServerCtx } from "@/lib/server-context";
import { aiChatUrl, aiKey, aiModel } from "@/lib/ai.server";
import { todayRiyadh } from "@/lib/dates";

/** تشغيل التذكير الذكي الآن (يعمل تلقائيًا كل صباح 11 بتوقيت السعودية أيضًا). */
export const runSmartReminders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const { data: n, error } = await ctx.supabase.rpc("smart_payment_reminders");
    if (error) throw error;
    return { count: Number(n ?? 0) };
  });

/** تحويل طلب وحدة من زائر إلى صفقة في مسار المبيعات. */
export const createDealFromRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) =>
    z.object({ requestId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);

    const { data: req, error } = await ctx.supabase
      .from("unit_requests")
      .select("*")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req) throw new Error("لم نجد الطلب");
    if (req.status === "converted") throw new Error("الطلب تحوّل إلى صفقة مسبقًا");

    // Claim the request first (conditional update) so a double click or a retry cannot
    // create two deals from the same request.
    const { data: claimed, error: claimErr } = await ctx.supabase
      .from("unit_requests")
      .update({ status: "converted" })
      .eq("id", data.requestId)
      .neq("status", "converted")
      .select("id");
    if (claimErr) throw claimErr;
    if (!claimed || claimed.length === 0) throw new Error("الطلب تحوّل إلى صفقة مسبقًا");

    const { data: deal, error: dealErr } = await ctx.supabase
      .from("deals")
      .insert({
        client_name: req.full_name,
        phone: req.phone,
        request_type: req.unit_type ?? "rent",
        stage: "lead",
        value: req.budget ?? 0,
        notes: [
          req.district ? `الحي: ${req.district}` : null,
          req.city ? `المدينة: ${req.city}` : null,
          req.notes,
        ]
          .filter(Boolean)
          .join(" · "),
        assigned_to: ctx.userId,
      })
      .select("id")
      .single();
    if (dealErr) {
      // Give the request back so it can be converted again.
      await ctx.supabase
        .from("unit_requests")
        .update({ status: req.status })
        .eq("id", data.requestId);
      throw dealErr;
    }

    return { dealId: deal.id };
  });

/** جدولة ذكية: يسند الطلب للفني الأقل تحميلًا ويقترح موعدًا حسب الأولوية. */
const priorityHours: Record<string, number> = { urgent: 4, high: 24, medium: 72, low: 168 };

export const smartScheduleMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { requestId: string }) =>
    z.object({ requestId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);
    const orgId = await getMyOrgId(ctx);

    const { data: req, error } = await ctx.supabase
      .from("maintenance_requests")
      .select("id, title, priority, status, unit_id, units(property_id)")
      .eq("id", data.requestId)
      .maybeSingle();
    if (error || !req) throw new Error("لم نجد طلب الصيانة");

    // Only this office's own technicians: the database refuses a job assigned to anyone else.
    const { data: techs } = await ctx.supabase
      .from("user_roles")
      .select("user_id, org_members!inner(org_id)")
      .eq("role", "technician")
      .eq("org_members.org_id", orgId);
    const techIds = (techs ?? []).map((t) => t.user_id);
    if (techIds.length === 0)
      throw new Error("لا يوجد فنيون — أضف مستخدمًا بدور «فني» من شاشة المستخدمين");

    const { data: open } = await ctx.supabase
      .from("maintenance_requests")
      .select("technician_id, units(property_id)")
      .in("technician_id", techIds)
      .neq("status", "done");
    const load = new Map<string, number>(techIds.map((id) => [id, 0]));
    // بدون إحداثيات على الفنيين، "الأقرب" وكيل تقريبي: فني عنده مهمة مفتوحة أخرى بنفس العقار على
    // الأرجح موجود بالمنطقة فعلًا — يُستخدم فقط كاسر تعادل بين فنيين متساويين بالتحميل، لا كأولوية
    // أولى (تفادي التحميل غير العادل على فني واحد لمجرد قربه).
    const nearProperty = req.units?.property_id ?? null;
    const near = new Set<string>();
    for (const row of open ?? []) {
      if (row.technician_id && load.has(row.technician_id)) {
        load.set(row.technician_id, (load.get(row.technician_id) ?? 0) + 1);
        if (nearProperty && row.units?.property_id === nearProperty) near.add(row.technician_id);
      }
    }
    const sorted = [...load.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return Number(near.has(b[0])) - Number(near.has(a[0]));
    });
    const techId: string = sorted[0]?.[0] ?? techIds[0]!;
    const hours = priorityHours[req.priority] ?? 72;
    const scheduledAt = new Date(Date.now() + hours * 3600000).toISOString();

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: upErr } = await supabaseAdmin
      .from("maintenance_requests")
      .update({
        technician_id: techId,
        scheduled_at: scheduledAt,
        status: req.status === "new" ? "in_progress" : req.status,
      })
      .eq("id", data.requestId);
    if (upErr) throw upErr;

    const { data: prof } = await supabaseAdmin
      .from("profiles")
      .select("full_name")
      .eq("id", techId)
      .maybeSingle();

    await supabaseAdmin.from("notifications").insert({
      user_id: techId,
      org_id: orgId,
      title: "أُسند إليك عمل صيانة",
      body: `${req.title} — موعد مقترح ${new Date(scheduledAt).toLocaleString("ar-SA")}`,
      kind: "maintenance",
      source: "system",
      related_table: "maintenance_requests",
      related_id: data.requestId,
    });

    return { technician: prof?.full_name ?? "الفني", scheduledAt };
  });

/** تحديد مواقع العقارات على الخريطة تلقائيًا (تحويل العنوان إلى إحداثيات). */
export const geocodeProperties = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);

    const { data: props, error } = await ctx.supabase
      .from("properties")
      .select("id, name, city, district, lat, lng")
      .is("lat", null)
      .limit(10);
    if (error) throw error;

    let updated = 0;
    for (const p of props ?? []) {
      const q = [p.name, p.district ? `حي ${p.district}` : null, p.city, "Saudi Arabia"]
        .filter(Boolean)
        .join(", ");
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=sa&q=${encodeURIComponent(q)}`,
          { headers: { "User-Agent": "Aqari-Platform/1.0 (property management)" } },
        );
        const rows = (await res.json()) as { lat: string; lon: string }[];
        if (rows[0]?.lat && rows[0]?.lon) {
          const { error: upErr } = await ctx.supabase
            .from("properties")
            .update({ lat: Number(rows[0].lat), lng: Number(rows[0].lon) })
            .eq("id", p.id);
          if (!upErr) updated++;
        }
      } catch {
        // تجاهل — سنحاول لاحقًا
      }
      await new Promise((r) => setTimeout(r, 1100));
    }

    const { count } = await ctx.supabase
      .from("properties")
      .select("id", { count: "exact", head: true })
      .is("lat", null);
    return { updated, remaining: Number(count ?? 0) };
  });

/** أقصى عدد طلبات من الرقم نفسه خلال الساعة (الصفحة عامة بدون تسجيل). */
const MAX_UNIT_REQUESTS_PER_PHONE_PER_HOUR = 3;

/** طلب وحدة من زائر (صفحة عامة بدون تسجيل). */
export const submitUnitRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        fullName: z.string().min(2).max(120),
        phone: z.string().regex(/^[0-9+\s-]{9,15}$/, "رقم جوال غير صحيح"),
        city: z.string().max(80).optional(),
        district: z.string().max(80).optional(),
        unitType: z.string().max(40).optional(),
        budget: z.number().min(0).max(10_000_000).optional(),
        notes: z.string().max(600).optional(),
        /** The office whose listing the visitor is looking at (defaults to the oldest listed office). */
        officeId: z.string().uuid().optional(),
        /** Is the visitor renting or buying? */
        purpose: z.enum(["rent", "sale"]).default("rent"),
        /** Referral code of an existing owner/tenant, if the visitor was referred by one. */
        referralCode: z.string().trim().max(20).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");
    const { resolvePublicOffice } = await import("@/lib/org.server");

    // The request goes to the office being viewed (if it is publicly listed and verified).
    const orgId = await resolvePublicOffice(supabaseAdmin, data.officeId ?? null);
    if (!orgId) throw new Error("لا توجد مكاتب متاحة لاستقبال الطلب حاليًا");

    // Every accepted request notifies all staff, so throttle repeat submissions from one number —
    // scoped to the office actually being spammed, not globally: a visitor genuinely comparing
    // listings across several offices within the hour (one request per office) was being blocked
    // after the 3rd office purely because the count summed every office together.
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { count: recent } = await supabaseAdmin
      .from("unit_requests")
      .select("id", { count: "exact", head: true })
      .eq("phone", data.phone)
      .eq("org_id", orgId)
      .gte("created_at", since);
    if ((recent ?? 0) >= MAX_UNIT_REQUESTS_PER_PHONE_PER_HOUR) {
      throw new Error("وصلتنا طلباتك خلال الساعة الماضية — سنتواصل معك قريبًا");
    }

    const { data: created, error } = await supabaseAdmin
      .from("unit_requests")
      .insert({
        org_id: orgId,
        full_name: data.fullName,
        phone: data.phone,
        city: data.city ?? null,
        district: data.district ?? null,
        unit_type: data.unitType ?? null,
        purpose: data.purpose,
        budget: data.budget ?? 0,
        notes: data.notes ?? null,
      })
      .select("id")
      .single();
    if (error) throw new Error("تعذّر إرسال الطلب — حاول مرة أخرى");

    await notifyStaff(supabaseAdmin, orgId, {
      title: data.purpose === "sale" ? "طلب شراء من زائر" : "طلب وحدة للإيجار من زائر",
      body: `${data.fullName} — ${data.phone}${data.district ? ` · حي ${data.district}` : ""}${data.unitType ? ` · ${data.unitType}` : ""}${data.budget ? ` · الميزانية ${data.budget} ر.س` : ""}`,
      kind: "deal",
      related_table: "unit_requests",
      related_id: created?.id ?? orgId ?? "public",
    });

    // رمز إحالة صحيح يسجّل إحالة معلّقة لدى مكتب هذا الطلب — فشل صامت لو الرمز غير صحيح، ما
    // يستاهل نرفض طلب الوحدة كامل لأجل رمز خاطئ.
    if (data.referralCode) {
      const { data: code } = await supabaseAdmin
        .from("referral_codes")
        .select("user_id")
        .eq("code", data.referralCode.toUpperCase())
        .maybeSingle();
      if (code) {
        await supabaseAdmin.from("referrals").insert({
          referrer_id: code.user_id,
          referred_name: data.fullName,
          referred_phone: data.phone,
          org_id: orgId,
        });
      }
    }
    return { ok: true };
  });

/** أقصى عدد أحداث لنفس الوحدة خلال دقيقة (يحمي من حلقة زر معطوبة أو زحف آلي، لا من كل تلاعب). */
const MAX_LISTING_EVENTS_PER_UNIT_PER_MINUTE = 30;

/** تسجيل مشاهدة أو نقرة اتصال/واتساب على صفحة عرض عامة — لتقرير أداء الإعلان لكل وحدة. */
export const trackListingEvent = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        unitId: z.string().uuid(),
        eventType: z.enum(["view", "call_click", "whatsapp_click"]),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { orgOf } = await import("@/lib/org.server");

    // فشل صامت: هذا مؤشر أداء إضافي، ما يستاهل نعطّل زر الاتصال أو نظهر خطأ لزائر لمجرد تعذّر
    // تسجيل الحدث (وحدة يتيمة بلا مكتب واضح، أو مشكلة اتصال مؤقتة بقاعدة البيانات).
    try {
      const orgId = await orgOf(supabaseAdmin, "units", data.unitId);

      const since = new Date(Date.now() - 60_000).toISOString();
      const { count: recent } = await supabaseAdmin
        .from("listing_events")
        .select("id", { count: "exact", head: true })
        .eq("unit_id", data.unitId)
        .gte("created_at", since);
      if ((recent ?? 0) >= MAX_LISTING_EVENTS_PER_UNIT_PER_MINUTE) return { ok: true };

      await supabaseAdmin.from("listing_events").insert({
        unit_id: data.unitId,
        org_id: orgId,
        event_type: data.eventType,
      });
    } catch {
      // تجاهل — لا نكسر تجربة الزائر لأجل تحليلات
    }
    return { ok: true };
  });

/** أقصى عدد زيارات لنفس المعرّف المجهول خلال دقيقة (يحمي من زحف آلي، لا من كل تلاعب). */
const MAX_SITE_VISITS_PER_VISITOR_PER_MINUTE = 20;

/** تسجيل تحميل صفحة عامة — لعدّاد "زوّار الموقع" بلوحة المدير العام. مثل trackListingEvent تمامًا:
 * فشل صامت، بلا middleware auth (أغلب الزوار بلا جلسة دخول). */
export const trackSiteVisit = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ path: z.string().min(1).max(200), visitorId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    try {
      const since = new Date(Date.now() - 60_000).toISOString();
      const { count: recent } = await supabaseAdmin
        .from("site_visits")
        .select("id", { count: "exact", head: true })
        .eq("visitor_id", data.visitorId)
        .gte("created_at", since);
      if ((recent ?? 0) >= MAX_SITE_VISITS_PER_VISITOR_PER_MINUTE) return { ok: true };

      await supabaseAdmin.from("site_visits").insert({
        path: data.path,
        visitor_id: data.visitorId,
      });
    } catch {
      // تجاهل — لا نكسر تجربة الزائر لأجل تحليلات
    }
    return { ok: true };
  });

/** المستأجر يوافق على تجديد عقده أو يطلب المغادرة. */
export const submitRenewalDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { leaseId: string; decision: "renew" | "leave"; note?: string }) =>
    z
      .object({
        leaseId: z.string().uuid(),
        decision: z.enum(["renew", "leave"]),
        note: z.string().max(400).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    const { data: lease, error } = await ctx.supabase
      .from("leases")
      .select("id, tenant_id, unit_id, tenants!inner(user_id)")
      .eq("id", data.leaseId)
      .maybeSingle();
    if (error || !lease || lease.tenants?.user_id !== ctx.userId) {
      throw new Error("هذا العقد ليس في حسابك");
    }

    // One open request per lease: each request notifies all staff.
    const { count: open } = await ctx.supabase
      .from("renewal_requests")
      .select("id", { count: "exact", head: true })
      .eq("lease_id", data.leaseId)
      .eq("status", "new");
    if ((open ?? 0) > 0) throw new Error("لديك طلب قائم لهذا العقد — بانتظار رد المكتب");

    const { error: insErr } = await ctx.supabase.from("renewal_requests").insert({
      lease_id: data.leaseId,
      tenant_id: lease.tenant_id,
      decision: data.decision,
      note: data.note ?? null,
    });
    if (insErr) throw new Error("تعذّر إرسال قرارك — حاول مرة أخرى");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");
    const { orgOf } = await import("@/lib/org.server");
    const orgId = await orgOf(supabaseAdmin, "leases", data.leaseId);
    await notifyStaff(supabaseAdmin, orgId, {
      title: data.decision === "renew" ? "المستأجر وافق على تجديد عقده" : "المستأجر يطلب المغادرة",
      body: `${data.note ? `ملاحظة: ${data.note}` : "راجع شاشة تجديد العقود"}`,
      kind: "lease",
      related_table: "renewal_requests",
      related_id: data.leaseId,
    });
    return { ok: true };
  });

/** الموظف يسوّي وديعة التأمين عند خروج المستأجر (مرة واحدة فقط). */
/**
 * A deposit is settled once the tenant is leaving: the lease ended or was terminated, or it is
 * still marked active but its end date has arrived. Never while the lease is running.
 */
export function depositSettleable(
  lease: { status: string; end_date: string },
  today: string = todayRiyadh(),
): boolean {
  if (lease.status === "expired" || lease.status === "terminated") return true;
  return lease.status === "active" && lease.end_date.slice(0, 10) <= today;
}

const riyals = (n: number) => `${n.toLocaleString("ar-SA", { maximumFractionDigits: 2 })} ر.س`;

export const settleDeposit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      leaseId: string;
      status: "refunded" | "deducted";
      note?: string;
      deductedAmount?: number;
    }) =>
      z
        .object({
          leaseId: z.string().uuid(),
          status: z.enum(["refunded", "deducted"]),
          note: z.string().trim().max(200).optional(),
          deductedAmount: z.number().positive().optional(),
        })
        .refine((v) => v.status !== "deducted" || (v.deductedAmount && v.note), {
          message: "أدخل مبلغ الخصم وسببه",
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireStaff(ctx);

    const { data: lease, error } = await ctx.supabase
      .from("leases")
      .select("id, unit_id, deposit, deposit_status, status, end_date")
      .eq("id", data.leaseId)
      .maybeSingle();
    if (error || !lease) throw new Error("لم نجد العقد");
    if (lease.deposit_status !== "held") throw new Error("سبقت تسوية هذه الوديعة");
    if (!depositSettleable(lease)) throw new Error("لا تُسوّى الوديعة قبل انتهاء العقد");

    const deposit = Number(lease.deposit) || 0;
    let note = data.note || null;
    if (data.status === "deducted") {
      const amount = data.deductedAmount ?? 0;
      if (amount > deposit) throw new Error(`مبلغ الخصم أكبر من الوديعة (${riyals(deposit)})`);
      // leases has no column for the deducted amount, so it is recorded in the settlement note.
      note = `خُصم ${riyals(amount)} من ${riyals(deposit)} ويُعاد ${riyals(deposit - amount)} — ${data.note}`;
    }

    // Conditional update so two staff members cannot settle (and notify) the same deposit twice.
    const { data: settled, error: upErr } = await ctx.supabase
      .from("leases")
      .update({ deposit_status: data.status, deposit_note: note })
      .eq("id", data.leaseId)
      .eq("deposit_status", "held")
      .select("id");
    if (upErr) throw upErr;
    if (!settled || settled.length === 0) throw new Error("سبقت تسوية هذه الوديعة");

    if (lease.unit_id) {
      const { error: notifyErr } = await ctx.supabase.rpc("notify_unit_staff", {
        _unit_id: lease.unit_id,
        _title: data.status === "refunded" ? "تم استرداد وديعة التأمين" : "تم تسوية وديعة التأمين",
        _body:
          data.status === "refunded"
            ? `الوديعة ${riyals(deposit)} — استُردت كاملة${note ? ` · ${note}` : ""}`
            : `الوديعة ${riyals(deposit)} — ${note}`,
        _kind: "lease",
      });
      if (notifyErr) console.error("[settleDeposit] notify_unit_staff failed:", notifyErr.message);
    }
    return { ok: true };
  });

/** أكبر مقطع صوتي نرسله للذكاء الاصطناعي (حماية من التكلفة والذاكرة). */
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

/** طلب صيانة سريع: صورة + وصف صوتي يتحوّل نصًا بالذكاء الاصطناعي. */
async function transcribeInto(
  supabase: SupabaseClient<Database>,
  audioPath: string,
  apply: (text: string) => void,
): Promise<boolean> {
  const apiKey = aiKey();
  if (!apiKey) return false;
  try {
    // Download with the caller's own client so storage RLS applies (the admin client would
    // read any object in the bucket).
    const { data: blob, error } = await supabase.storage
      .from("maintenance-media")
      .download(audioPath);
    if (error || !blob || blob.size > MAX_AUDIO_BYTES) return false;
    const base64 = Buffer.from(await blob.arrayBuffer()).toString("base64");
    const format = audioPath.endsWith(".ogg") ? "ogg" : audioPath.endsWith(".mp3") ? "mp3" : "webm";
    const res = await fetch(aiChatUrl(), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: aiModel(),
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: 'حوّل هذا المقطع الصوتي إلى نص عربي واضح يشرح مشكلة الصيانة. أعد JSON فقط بصيغة {"text": "النص"}',
              },
              { type: "input_audio", input_audio: { data: base64, format } },
            ],
          },
        ],
      }),
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = json.choices?.[0]?.message?.content ?? "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return false;
    const parsed = JSON.parse(match[0]) as { text?: string };
    if (parsed.text?.trim()) {
      apply(parsed.text.trim());
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** True when a storage path sits inside the caller's own folder (files are `${uid}/...`). */
function isOwnStoragePath(path: string, userId: string): boolean {
  return path.startsWith(`${userId}/`) && !path.includes("..");
}

export const submitQuickMaintenance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { title: string; description?: string; photoPath?: string; audioPath?: string }) =>
      z
        .object({
          title: z.string().min(2).max(120),
          description: z.string().max(1000).optional(),
          photoPath: z.string().max(300).optional(),
          audioPath: z.string().max(300).optional(),
        })
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;

    for (const p of [data.photoPath, data.audioPath]) {
      if (p && !isOwnStoragePath(p, ctx.userId)) throw new Error("مرفق غير صالح");
    }

    // The request is filed as the caller's own tenant record, never as "whoever RLS lets me see" —
    // but one auth account can hold more than one tenants row (no uniqueness on user_id: e.g. a
    // tenancy at a second office). Picking "any" row here (no order) could land on one with no
    // active lease while another of the account's own records does, silently filing the request
    // unit-less/at the wrong office. Instead: find the account's most-recently-started ACTIVE
    // lease across ALL its tenant records, and derive tenant_id from that lease — the tenant row
    // itself is only a fallback for an account with no active lease at all (unchanged behavior
    // for that case; still lets them file a request, just without a unit attached).
    const { data: tenantRows } = await ctx.supabase
      .from("tenants")
      .select("id")
      .eq("user_id", ctx.userId)
      .order("created_at", { ascending: false });
    const tenantIds = (tenantRows ?? []).map((t) => t.id);
    if (tenantIds.length === 0) throw new Error("حسابك غير مربوط ببيانات مستأجر — تواصل مع المكتب");

    const { data: lease } = await ctx.supabase
      .from("leases")
      .select("id, unit_id, tenant_id")
      .in("tenant_id", tenantIds)
      .eq("status", "active")
      .order("start_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Non-null: tenantIds.length === 0 already threw above.
    const tenant = { id: lease?.tenant_id ?? tenantIds[0]! };

    let description = data.description ?? "";
    let transcript = false;
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { notifyStaff } = await import("@/lib/notify.server");
    const { orgOf } = await import("@/lib/org.server");
    // The office of the tenant's record: the request is filed there, and only its staff hear about it.
    const orgId = await orgOf(supabaseAdmin, "tenants", tenant.id);
    if (data.audioPath) {
      transcript = await transcribeInto(ctx.supabase, data.audioPath, (t) => {
        description = description ? `${description}\n— وصف صوتي: ${t}` : t;
      });
    }

    const priority = classifyMaintenancePriority(data.title, description, "medium");

    const { data: created, error } = await supabaseAdmin
      .from("maintenance_requests")
      .insert({
        title: data.title,
        description: description || null,
        tenant_id: tenant.id,
        unit_id: lease?.unit_id ?? null,
        source: "app",
        priority,
        photo_path: data.photoPath ?? null,
        audio_path: data.audioPath ?? null,
        org_id: orgId,
      })
      .select("id")
      .single();
    if (error) throw new Error("تعذّر إرسال الطلب — حاول مرة أخرى");

    await notifyStaff(supabaseAdmin, orgId, {
      title: priority === "urgent" ? "🚨 طلب صيانة عاجل من المستأجر" : "طلب صيانة سريع من المستأجر",
      body: data.title,
      kind: "maintenance",
      related_table: "maintenance_requests",
      related_id: created?.id ?? "",
    });

    // العاجل يستاهل قناة أسرع من الإشعار الداخلي وحده — نفس نمط تنبيه المكتب بواتساب المستخدم
    // بموافقات الصيانة (portal-actions.functions.ts).
    if (priority === "urgent") {
      const { data: org } = await supabaseAdmin
        .from("org_settings")
        .select("office_phone, whatsapp_number")
        .eq("id", orgId)
        .maybeSingle();
      const officePhone = org?.whatsapp_number ?? org?.office_phone ?? null;
      if (officePhone) {
        const { sendWhatsappOut } = await import("@/lib/whatsapp-out.server");
        await sendWhatsappOut({
          orgId,
          phone: officePhone,
          body: `🚨 طلب صيانة عاجل: ${data.title}`,
          intent: "صيانة عاجلة",
        });
      }
    }
    return { ok: true, transcript };
  });
