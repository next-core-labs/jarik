import { FURNISHING_LABEL, furnitureSummary, isFurnishing, parseFurniture } from "@/lib/furniture";

/** «٦ أدوار · بناء 2018 · مصعدان · 12 موقفًا» — whatever the building record has, or null. */
export function buildingSpecsLine(p: {
  floors_count: number | null;
  year_built: number | null;
  elevators: number | null;
  parking_spaces: number | null;
}): string | null {
  const parts = [
    p.floors_count != null ? `${p.floors_count} أدوار` : null,
    p.year_built != null ? `بناء ${p.year_built}` : null,
    p.elevators != null && p.elevators > 0 ? `${p.elevators} مصعد` : null,
    p.parking_spaces != null && p.parking_spaces > 0 ? `${p.parking_spaces} موقف` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** «مؤثثة جزئيًا: مكيف سبليت ×3، ثلاجة…» on a unit card. */
export function UnitFurnishingLine({
  furnishing,
  furniture,
  icon,
}: {
  furnishing: string | null | undefined;
  furniture: unknown;
  icon?: React.ReactNode;
}) {
  const level = isFurnishing(furnishing) ? furnishing : "none";
  const items = parseFurniture(furniture);
  return (
    <p className="flex items-start gap-1.5">
      {icon}
      <span>
        {FURNISHING_LABEL[level]}
        {level !== "none" && items.length > 0 ? `: ${furnitureSummary(items)}` : ""}
      </span>
    </p>
  );
}

/** «3 غرف · 1 صالة · 2 حمام · 140 م² · الدور 2» */
export function unitSpecsLine(u: {
  rooms: number | null;
  halls: number | null;
  bathrooms: number | null;
  area: number | null;
  floor_no?: string | null;
}): string {
  return [
    u.rooms != null ? `${u.rooms} غرف` : null,
    u.halls != null ? `${u.halls} صالة` : null,
    u.bathrooms != null ? `${u.bathrooms} حمام` : null,
    u.area != null ? `${u.area} م²` : null,
    u.floor_no ? `الدور ${u.floor_no}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
