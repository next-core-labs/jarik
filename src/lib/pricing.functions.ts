import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateAdAi, suggestRentAi } from "./pricing.server";

export const suggestRent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        unitType: z.string().min(1),
        district: z.string(),
        rooms: z.number().nullable(),
        halls: z.number().nullable(),
        bathrooms: z.number().nullable(),
        area: z.number().nullable(),
        furnished: z.boolean(),
        floorNo: z.string().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", {
      _user_id: context.userId,
    });
    if (!staff) throw new Error("forbidden");

    const { data: market } = await context.supabase.rpc("market_stats");
    return suggestRentAi({ ...data, market: market ?? [] });
  });

export const generateAdText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ unitId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { data: staff } = await context.supabase.rpc("is_staff", {
      _user_id: context.userId,
    });
    if (!staff) throw new Error("forbidden");

    const { data: unit, error } = await context.supabase
      .from("units")
      .select(
        "unit_number, unit_name, unit_type, district, street, floor_no, rooms, halls, bathrooms, area, annual_rent, furnished, properties(name, city)",
      )
      .eq("id", data.unitId)
      .single();
    if (error || !unit) throw new Error("الوحدة غير موجودة");

    // The ad is signed with the caller's own office, never whichever office row comes back first.
    const { data: orgId } = await context.supabase.rpc("my_org_id");
    const org = orgId
      ? (
          await context.supabase
            .from("org_settings")
            .select("company_name, office_phone")
            .eq("id", orgId)
            .maybeSingle()
        ).data
      : null;

    return generateAdAi({
      unitNumber: unit.unit_number,
      unitName: unit.unit_name,
      unitType: unit.unit_type,
      district: unit.district,
      street: unit.street,
      floorNo: unit.floor_no,
      rooms: unit.rooms,
      halls: unit.halls,
      bathrooms: unit.bathrooms,
      area: unit.area,
      annualRent: Number(unit.annual_rent ?? 0),
      furnished: Boolean(unit.furnished),
      officeName: org?.company_name ?? unit.properties?.name ?? null,
      officePhone: org?.office_phone ?? null,
      city: unit.properties?.city ?? null,
    });
  });
