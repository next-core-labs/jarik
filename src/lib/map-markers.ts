import type { NearbyPlace } from "@/lib/nearby-places.functions";

// Kept apart from the Leaflet map modules so a page can draw the legend without pulling Leaflet into
// its main bundle — the maps themselves load lazily.

/**
 * Property markers on the occupancy map: green = fully let, amber = has vacant units, gray =
 * nothing let and nothing vacant (no units, all sold, or all under maintenance).
 */
export const OCCUPANCY_COLOR = { full: "#1F7A4D", vacant: "#9A6200", none: "#8E8986" } as const;

export function occupancyColor(p: { unitsCount: number; occupied: number; vacant: number }) {
  if (p.unitsCount === 0) return OCCUPANCY_COLOR.none;
  if (p.vacant > 0) return OCCUPANCY_COLOR.vacant;
  return p.occupied > 0 ? OCCUPANCY_COLOR.full : OCCUPANCY_COLOR.none;
}

/**
 * Nearby services are small neutral squares (ink at 60%) told apart by a one-letter glyph, never by
 * hue — the design system keeps a single colour on the map for services. The colour stays keyed
 * per kind so legends and lists can keep reading it.
 */
const SERVICE_INK = "#6E6A66";
export const NEARBY_KIND_COLOR: Record<NearbyPlace["kind"], string> = {
  mosque: SERVICE_INK,
  school: SERVICE_INK,
  market: SERVICE_INK,
  health: SERVICE_INK,
  park: SERVICE_INK,
  fuel: SERVICE_INK,
  food: SERVICE_INK,
  mall: SERVICE_INK,
  transit: SERVICE_INK,
  other: SERVICE_INK,
};

export const NEARBY_KIND_GLYPH: Record<NearbyPlace["kind"], string> = {
  mosque: "م",
  school: "د",
  market: "س",
  health: "ص",
  park: "ح",
  fuel: "و",
  food: "ق",
  mall: "ل",
  transit: "ن",
  other: "•",
};

export const NEARBY_KIND_LABEL: Record<NearbyPlace["kind"], string> = {
  mosque: "مسجد",
  school: "مدرسة",
  market: "سوق",
  health: "صحة",
  park: "حديقة",
  fuel: "محطة وقود",
  food: "مطعم ومقهى",
  mall: "مول",
  transit: "نقل عام",
  other: "قريب",
};

/** Straight-line distance in metres between two coordinates (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/* ── Map marker HTML (Leaflet divIcon bodies). Plain strings so they stay Leaflet-free. ── */

const FONT = "font-family:'IBM Plex Sans Arabic','Archivo',sans-serif";

/** Short price for a pin: 48K for thousands, 1.2M for millions. */
export function pinPrice(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(Math.round(n));
}

/**
 * Price pin: rent = ink fill, sale = white with an ink frame; the hovered/selected one turns red and
 * grows — the single red element on the map. Anchored at its tip.
 */
export function pricePinHtml(label: string, purpose: "rent" | "sale", hot: boolean): string {
  const rent = purpose === "rent";
  const bg = hot ? "#EC3013" : rent ? "#201E1D" : "#FFFFFF";
  const fg = hot || rent ? "#FFFFFF" : "#201E1D";
  const ring = hot || rent ? "" : "inset 0 0 0 2px #201E1D,";
  const shadow = hot ? "0 6px 14px rgba(236,48,19,.35)" : "0 2px 6px rgba(32,30,29,.18)";
  const tip = hot ? "#EC3013" : "#201E1D";
  const h = hot ? 34 : 30;
  return (
    `<div style="position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;cursor:pointer;${FONT}">` +
    `<span style="height:${h}px;padding:0 ${hot ? 12 : 9}px;background:${bg};color:${fg};box-shadow:${ring}${shadow};display:flex;align-items:center;font-weight:700;font-size:${hot ? 15 : 13}px;white-space:nowrap;font-variant-numeric:tabular-nums">${label}</span>` +
    `<span style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:7px solid ${tip}"></span></div>`
  );
}

/** Cluster: an ink circle that grows with its count (36 / 48 / 60); red when it holds the hovered
 *  or selected offer. Clicking zooms in. */
export function clusterHtml(count: number, hot = false): string {
  const size = count >= 50 ? 60 : count >= 10 ? 48 : 36;
  return `<div style="position:absolute;transform:translate(-50%,-50%);width:${size}px;height:${size}px;border-radius:50%;background:${hot ? "#EC3013" : "#201E1D"};color:#F3F2F2;box-shadow:0 0 0 ${size >= 48 ? 6 : 4}px rgba(32,30,29,.15);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:${size >= 48 ? 15 : 13}px;cursor:pointer;${FONT}">${count}</div>`;
}

/** "Me": the visitor's position, in blue. */
export const ORIGIN_DOT_HTML =
  '<div style="position:absolute;transform:translate(-50%,-50%);width:18px;height:18px;border-radius:50%;background:#255F9E;box-shadow:0 0 0 4px #FFFFFF,0 0 0 12px rgba(37,95,158,.2)"></div>';

/** The listing's own (approximate) spot: the red arch — the logo's "your home". */
export const HOME_ARCH_PIN_HTML =
  '<svg width="34" height="34" viewBox="0 0 40 40" style="position:absolute;transform:translate(-50%,-50%)"><path fill="#EC3013" d="M4 40V20a16 16 0 0 1 32 0V40Z"/></svg>';

/** A nearby service: neutral square with its kind's glyph; `active` uses full ink. */
export function serviceSquareHtml(kind: NearbyPlace["kind"], active = false): string {
  return `<div style="position:absolute;transform:translate(-50%,-50%);width:24px;height:24px;background:${active ? "#201E1D" : NEARBY_KIND_COLOR[kind]};color:#F3F2F2;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;box-shadow:0 0 0 2px #FFFFFF;${FONT}">${NEARBY_KIND_GLYPH[kind]}</div>`;
}
