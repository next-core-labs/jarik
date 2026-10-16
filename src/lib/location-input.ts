/**
 * A property's location as staff actually have it: pasted coordinates («24.81, 46.61») or a Google
 * Maps link. Dependency-free so the listings import script (Node) can use it too.
 */
export type LatLng = { lat: number; lng: number };

/** Saudi Arabia's bounding box, with a little margin — catches swapped or mistyped coordinates. */
export function isInSaudi({ lat, lng }: LatLng): boolean {
  return lat >= 16 && lat <= 32.5 && lng >= 34.4 && lng <= 55.7;
}

const PAIR = /(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/;

/**
 * Coordinates from text: a bare «lat, lng» pair, or a full Google Maps URL (`@lat,lng,17z`,
 * `!3dlat!4dlng`, `?q=lat,lng`, `ll=` / `query=` / `destination=`). Short links (maps.app.goo.gl)
 * hold no coordinates until they are opened, so they return null. Arabic-Indic digits are accepted.
 */
export function parseLocation(input: string): LatLng | null {
  const text = decodeSafe(toWesternDigits(input.trim())).replace(/،/g, ",");
  if (!text) return null;

  // The place pin (!3d…!4d…) is the listing itself; @… is only where the map view was centred.
  const pin = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(text);
  const param = /[?&](?:q|ll|query|destination|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(text);
  const at = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(text);
  const bare = /^[^a-z]*$/i.test(text) ? PAIR.exec(text) : null;

  const m = pin ?? param ?? at ?? bare;
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    return null;
  return { lat, lng };
}

function toWesternDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".");
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
