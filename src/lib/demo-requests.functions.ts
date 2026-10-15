import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requireHqPermission, type ServerCtx } from "@/lib/server-context";

/** Requests from the same number within the hour (the form is public, no sign-in). */
const MAX_PER_PHONE_PER_HOUR = 3;
/** All demo requests per hour, platform-wide — a cheap brake on a script filling the table. */
const MAX_PER_HOUR = 60;

export const DEMO_STATUS = ["new", "contacted", "closed"] as const;
export type DemoStatus = (typeof DEMO_STATUS)[number];

/**
 * «احجز عرضاً توضيحياً» from the "for offices" section of the marketplace. Public, so it writes with
 * the service role into demo_requests (no client grants) after the rate checks; /hq reads it below.
 */
export const submitDemoRequest = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        fullName: z.string().trim().min(2).max(120),
        phone: z
          .string()
          .trim()
          .regex(/^[0-9+\s-]{9,15}$/, "رقم جوال غير صحيح"),
        officeName: z.string().trim().max(160).optional(),
        city: z.string().trim().max(80).optional(),
        unitsCount: z.number().int().min(0).max(100_000).optional(),
        notes: z.string().trim().max(1000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const [byPhone, all] = await Promise.all([
      supabaseAdmin
        .from("demo_requests")
        .select("id", { count: "exact", head: true })
        .eq("phone", data.phone)
        .gte("created_at", since),
      supabaseAdmin
        .from("demo_requests")
        .select("id", { count: "exact", head: true })
        .gte("created_at", since),
    ]);
    if ((byPhone.count ?? 0) >= MAX_PER_PHONE_PER_HOUR || (all.count ?? 0) >= MAX_PER_HOUR) {
      throw new Error("وصلنا طلبك بالفعل — سنتواصل معك قريبًا");
    }

    const { error } = await supabaseAdmin.from("demo_requests").insert({
      full_name: data.fullName,
      phone: data.phone,
      office_name: data.officeName || null,
      city: data.city || null,
      units_count: data.unitsCount ?? null,
      notes: data.notes || null,
    });
    if (error) throw new Error("تعذّر إرسال الطلب — حاول مرة أخرى");
    return { ok: true };
  });

/** Latest demo requests for /hq → المكاتب والسوق. */
export const listDemoRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "offices");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("demo_requests")
      .select("id, full_name, phone, office_name, city, units_count, notes, status, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error("تعذّر تحميل طلبات العرض التوضيحي");
    return data ?? [];
  });

export const setDemoRequestStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), status: z.enum(DEMO_STATUS) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const ctx = context as unknown as ServerCtx;
    await requireHqPermission(ctx, "offices");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("demo_requests")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error("تعذّر تحديث الحالة");
    return { ok: true };
  });
