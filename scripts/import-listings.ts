#!/usr/bin/env node
// Import an office's real listings from a spreadsheet and publish them in the public market.
//
//   node scripts/import-listings.ts --template listings.xlsx           # blank sheet + instructions
//   node scripts/import-listings.ts --offices                           # offices and whether they can publish
//   node scripts/import-listings.ts listings.xlsx --office <id> [--photos <dir>]            # check only
//   node scripts/import-listings.ts listings.xlsx --office <id> [--photos <dir>] --commit   # write
//
// Needs SUPABASE_SERVICE_ROLE_KEY (env or .dev.vars — never commit it). Without --commit nothing is
// written: every row is validated first and any error stops the whole import, so a sheet is never
// half-imported. Re-running is safe: a property is matched by name within the office and a unit by
// its number within the property, so a second run updates them instead of duplicating.
//
// The office must be verified in /hq and have a FAL licence and a phone: REGA requires the licence on
// every property ad, and the listing's contact button calls the office.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";

import { createClient } from "@supabase/supabase-js";

import { AMENITIES } from "../src/lib/amenities.ts";
import { isInSaudi, parseLocation, type LatLng } from "../src/lib/location-input.ts";
import { PROPERTY_TYPE_GROUPS, PROPERTY_TYPES } from "../src/lib/property-types.ts";

const XLSX = createRequire(import.meta.url)("xlsx") as typeof import("xlsx");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SITE = "https://jarak-ksa.com";
const BUCKET = "listing-media";
const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

// Sheet columns: Arabic header (what staff see) → field. Required ones are marked.
const COLUMNS = [
  ["اسم العقار", "property", true, "يجمع الوحدات تحت عقار واحد، مثل: عمارة الملقا ٣"],
  ["رقم الوحدة", "unit_number", true, "فريد داخل العقار، مثل: 101"],
  ["الغرض", "purpose", true, "للإيجار أو للبيع"],
  ["نوع الوحدة", "unit_type", true, PROPERTY_TYPES.join("، ")],
  ["السعر", "price", true, "ريال: الإيجار السنوي أو سعر البيع"],
  ["المدينة", "city", true, "الرياض"],
  ["الحي", "district", true, "الملقا"],
  ["الموقع", "location", true, "إحداثيات 24.8073, 46.6129 أو رابط خرائط جوجل (المختصر مقبول)"],
  ["اسم الإعلان", "unit_name", false, "اختياري، مثل: شقة عائلية بمدخل خاص"],
  ["الشارع", "street", false, ""],
  ["الدور", "floor_no", false, "أرضي، 1، 2…"],
  ["الغرف", "rooms", false, "رقم"],
  ["الصالات", "halls", false, "رقم"],
  ["دورات المياه", "bathrooms", false, "رقم"],
  ["المساحة م²", "area", false, "رقم"],
  ["مؤثثة", "furnished", false, "نعم أو لا"],
  ["المزايا", "amenities", false, AMENITIES.join("، ")],
  ["الوصف", "description", false, "حتى 2000 حرف، يظهر للعموم"],
  [
    "الصور",
    "photos",
    false,
    "أسماء ملفات من مجلد --photos، أو اسم مجلد فيه صور الوحدة، أو روابط https — مفصولة بفاصلة",
  ],
] as const;
type Field = (typeof COLUMNS)[number][1];

type Row = {
  line: number;
  property: string;
  unit_number: string;
  purpose: "rent" | "sale";
  unit_type: string;
  price: number;
  city: string;
  district: string;
  location: LatLng;
  unit_name: string | null;
  street: string | null;
  floor_no: string | null;
  rooms: number | null;
  halls: number;
  bathrooms: number;
  area: number | null;
  furnished: boolean;
  amenities: string[];
  description: string | null;
  photos: string[]; // absolute file paths or https URLs
};

// ---------------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const option = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (flag("--help") || args.length === 0) {
  console.log(
    readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .slice(1, 15)
      .join("\n"),
  );
  process.exit(0);
}

const templatePath = option("--template");
if (templatePath) {
  writeTemplate(resolve(templatePath));
  process.exit(0);
}

const env = loadEnv();
const admin = createClient(env.url, env.serviceKey, { auth: { persistSession: false } });

if (flag("--offices")) {
  await listOffices();
  process.exit(0);
}

const file = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.match(/^--(office|photos)$/));
const officeId = option("--office");
const photosDir = option("--photos") ? resolve(option("--photos")!) : null;
if (!file || !officeId)
  fail("Usage: node scripts/import-listings.ts <sheet.xlsx|.csv> --office <id>");

const office = await checkOffice(officeId);
const rows = await readSheet(resolve(file));
console.log(`\n${rows.length} listings are valid for «${office.company_name}».`);
printSummary(rows);

if (!flag("--commit")) {
  console.log("\nCheck only — nothing was written. Run again with --commit to publish.");
  process.exit(0);
}
const published = await importRows(office.id, rows);
await verifyPublic(published);

// ---------------------------------------------------------------------------------------------------

function loadEnv() {
  const vars: Record<string, string> = {};
  for (const name of [".env", ".dev.vars"]) {
    const path = join(ROOT, name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/.exec(line);
      if (m) vars[m[1]!] = m[2]!;
    }
  }
  const pick = (k: string) => process.env[k] || vars[k];
  const url = pick("SUPABASE_URL") || pick("VITE_SUPABASE_URL");
  const serviceKey = pick("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = pick("SUPABASE_PUBLISHABLE_KEY") || pick("VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !anonKey) fail("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY missing from .env");
  if (!serviceKey)
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Put it in .dev.vars (git-ignored) or run:\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=sb_secret_… node scripts/import-listings.ts …",
    );
  return { url, serviceKey, anonKey };
}

async function listOffices() {
  const { data, error } = await admin
    .from("org_settings")
    .select(
      "id, company_name, verified, listed_publicly, fal_license_no, office_phone, whatsapp_number",
    )
    .order("created_at");
  if (error) fail(error.message);
  for (const o of data) {
    const problems = officeProblems(o);
    console.log(
      `${o.id}  ${o.company_name}  ${problems.length ? "✗ " + problems.join("; ") : "✓ can publish"}`,
    );
  }
}

type Office = {
  id: string;
  company_name: string;
  verified: boolean;
  listed_publicly: boolean;
  fal_license_no: string | null;
  office_phone: string | null;
  whatsapp_number: string | null;
};

function officeProblems(o: Office): string[] {
  const p: string[] = [];
  if (!o.verified) p.push("not verified (approve it in /hq → المكاتب)");
  if (!o.listed_publicly) p.push("«العرض العلني» is off in the office settings");
  if (!o.fal_license_no?.trim()) p.push("no FAL licence number (required by REGA on every ad)");
  if (!o.office_phone?.trim() && !o.whatsapp_number?.trim()) p.push("no phone or WhatsApp number");
  return p;
}

async function checkOffice(id: string): Promise<Office> {
  const { data, error } = await admin
    .from("org_settings")
    .select(
      "id, company_name, verified, listed_publicly, fal_license_no, office_phone, whatsapp_number",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) fail(error.message);
  if (!data) fail(`No office with id ${id}. List them with --offices.`);
  const problems = officeProblems(data);
  if (problems.length)
    fail(`«${data.company_name}» cannot publish yet:\n  - ${problems.join("\n  - ")}`);
  return data;
}

// ---------------------------------------------------------------------------------------------------

async function readSheet(path: string): Promise<Row[]> {
  if (!existsSync(path)) fail(`File not found: ${path}`);
  const book = XLSX.read(readFileSync(path), { type: "buffer" });
  const sheet = book.Sheets[book.SheetNames[0]!]!;
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "", raw: false });

  const known = new Map(COLUMNS.map(([header, field]) => [norm(header), field as Field]));
  const errors: string[] = [];
  const rows: Row[] = [];
  const seen = new Set<string>();

  for (const [i, record] of raw.entries()) {
    const line = i + 2; // header is line 1
    const get = (f: Field) => {
      for (const [k, v] of Object.entries(record)) if (known.get(norm(k)) === f) return clean(v);
      return "";
    };
    if (COLUMNS.every(([, f]) => !get(f))) continue; // blank line
    const err = (msg: string) => errors.push(`line ${line}: ${msg}`);

    for (const [header, f, required] of COLUMNS)
      if (required && !get(f)) err(`«${header}» is empty`);

    const purposeText = get("purpose");
    const purpose = /بيع|sale/i.test(purposeText)
      ? "sale"
      : /ايجار|إيجار|rent/i.test(purposeText)
        ? "rent"
        : null;
    if (purposeText && !purpose) err(`«الغرض» must be للإيجار or للبيع, got «${purposeText}»`);

    const unitType = get("unit_type");
    if (unitType && !PROPERTY_TYPES.includes(unitType)) err(`unknown «نوع الوحدة» «${unitType}»`);

    const price = toNumber(get("price"));
    const [lo, hi] = purpose === "sale" ? [10_000, 500_000_000] : [1_000, 10_000_000];
    if (get("price") && (price === null || price < lo || price > hi))
      err(`«السعر» ${get("price")} is outside ${lo.toLocaleString()}–${hi.toLocaleString()} SAR`);

    let location: LatLng | null = null;
    const locText = get("location");
    if (locText) {
      location = parseLocation(locText) ?? (await resolveShortLink(locText));
      if (!location) err(`cannot read coordinates from «الموقع» «${locText}»`);
      else if (!isInSaudi(location))
        err(`«الموقع» ${location.lat}, ${location.lng} is outside Saudi Arabia`);
    }

    const amenities = splitList(get("amenities"));
    for (const a of amenities)
      if (!(AMENITIES as readonly string[]).includes(a)) err(`unknown amenity «${a}»`);

    const ints: Partial<Record<Field, number | null>> = {};
    for (const f of ["rooms", "halls", "bathrooms", "area"] as const) {
      const v = get(f);
      ints[f] = v ? toNumber(v) : null;
      if (v && (ints[f] === null || ints[f]! < 0 || ints[f]! > (f === "area" ? 1_000_000 : 100)))
        err(`«${COLUMNS.find((c) => c[1] === f)![0]}» «${v}» is not a valid number`);
    }

    const description = get("description");
    if (description.length > 2000) err("«الوصف» is longer than 2000 characters");

    const photos: string[] = [];
    for (const p of splitList(get("photos"))) {
      const found = findPhotos(p);
      if (typeof found === "string") err(found);
      else photos.push(...found);
    }
    if (photos.length > MAX_PHOTOS)
      err(`${photos.length} photos — the listing shows at most ${MAX_PHOTOS}`);

    const key = `${get("property")}\u0000${get("unit_number")}`;
    if (seen.has(key)) err(`unit ${get("unit_number")} of «${get("property")}» appears twice`);
    seen.add(key);

    if (purpose && price !== null && location)
      rows.push({
        line,
        property: get("property"),
        unit_number: get("unit_number"),
        purpose,
        unit_type: unitType,
        price,
        city: get("city"),
        district: get("district"),
        location,
        unit_name: get("unit_name") || null,
        street: get("street") || null,
        floor_no: get("floor_no") || null,
        rooms: ints.rooms ?? null,
        halls: ints.halls ?? 0,
        bathrooms: ints.bathrooms ?? 0,
        area: ints.area ?? null,
        furnished: /^(نعم|yes|y|1|true|مؤثثة)$/i.test(get("furnished")),
        amenities,
        description: description || null,
        photos,
      });
  }

  if (errors.length)
    fail(
      `The sheet has ${errors.length} problem(s); nothing was imported:\n  ${errors.join("\n  ")}`,
    );
  if (rows.length === 0) fail("The sheet has no listings.");
  return rows;
}

function findPhotos(entry: string): string[] | string {
  if (/^https?:\/\//i.test(entry)) return [entry];
  if (!photosDir) return `photo «${entry}» needs --photos <folder>`;
  const path = join(photosDir, entry);
  if (!existsSync(path)) return `photo «${entry}» not found in ${photosDir}`;
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => IMAGE_TYPES[extname(f).toLowerCase()])
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => join(path, f))
    : [path];
  for (const f of files) {
    if (!IMAGE_TYPES[extname(f).toLowerCase()]) return `«${basename(f)}» is not JPG, PNG or WebP`;
    if (statSync(f).size > MAX_PHOTO_BYTES)
      return `«${basename(f)}» is over 8 MB — resize it first`;
  }
  return files.length ? files : `folder «${entry}» has no JPG/PNG/WebP photos`;
}

/** maps.app.goo.gl and goo.gl/maps links only reveal coordinates after their redirect. */
async function resolveShortLink(text: string): Promise<LatLng | null> {
  if (!/^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//i.test(text)) return null;
  try {
    const res = await fetch(text, { redirect: "follow" });
    return parseLocation(res.url) ?? parseLocation(await res.text());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------

async function importRows(orgId: string, rows: Row[]): Promise<{ id: string; row: Row }[]> {
  const propertyIds = new Map<string, string>();
  const out: { id: string; row: Row }[] = [];

  for (const row of rows) {
    let propertyId = propertyIds.get(row.property);
    if (!propertyId) {
      propertyId = await upsertProperty(orgId, row);
      propertyIds.set(row.property, propertyId);
    }

    const fields = {
      unit_name: row.unit_name,
      unit_type: row.unit_type,
      district: row.district,
      street: row.street,
      floor_no: row.floor_no,
      rooms: row.rooms,
      halls: row.halls,
      bathrooms: row.bathrooms,
      area: row.area,
      furnished: row.furnished,
      listing_purpose: row.purpose,
      annual_rent: row.purpose === "rent" ? row.price : 0,
      sale_price: row.purpose === "sale" ? row.price : 0,
      listing_description: row.description,
      amenities: row.amenities,
      market_listed: true,
    };

    const { data: existing, error: findErr } = await admin
      .from("units")
      .select("id, status, market_listed")
      .eq("property_id", propertyId)
      .eq("unit_number", row.unit_number)
      .maybeSingle();
    if (findErr) fail(`line ${row.line}: ${findErr.message}`);

    let unitId: string;
    if (existing) {
      if (existing.status !== "vacant") {
        console.log(
          `  line ${row.line}: unit ${row.unit_number} is ${existing.status} — left off the market`,
        );
        continue;
      }
      const { error } = await admin
        .from("units")
        .update({
          ...fields,
          ...(existing.market_listed ? {} : { market_listed_at: new Date().toISOString() }),
        })
        .eq("id", existing.id);
      if (error) fail(`line ${row.line}: ${error.message}`);
      unitId = existing.id;
    } else {
      const { data, error } = await admin
        .from("units")
        .insert({
          ...fields,
          property_id: propertyId,
          unit_number: row.unit_number,
          status: "vacant",
          market_listed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) fail(`line ${row.line}: ${error.message}`);
      unitId = data.id;
    }

    await addPhotos(unitId, row);
    out.push({ id: unitId, row });
    console.log(`  ✓ line ${row.line}: ${row.property} / ${row.unit_number}`);
  }
  return out;
}

async function upsertProperty(orgId: string, row: Row): Promise<string> {
  const { data: found, error } = await admin
    .from("properties")
    .select("id, lat, lng")
    .eq("org_id", orgId)
    .eq("name", row.property)
    .limit(1)
    .maybeSingle();
  if (error) fail(error.message);
  if (found) {
    if (found.lat == null || found.lng == null)
      await admin
        .from("properties")
        .update({ lat: row.location.lat, lng: row.location.lng })
        .eq("id", found.id);
    return found.id;
  }
  const group = PROPERTY_TYPE_GROUPS.find((g) => g.types.includes(row.unit_type))?.group ?? "سكني";
  const { data, error: insErr } = await admin
    .from("properties")
    .insert({
      org_id: orgId,
      name: row.property,
      property_type: group,
      city: row.city,
      district: row.district,
      address: row.street,
      lat: row.location.lat,
      lng: row.location.lng,
    })
    .select("id")
    .single();
  if (insErr) fail(insErr.message);
  return data.id;
}

/** Photos are added only to a unit that has none, so re-running never duplicates them. */
async function addPhotos(unitId: string, row: Row) {
  if (row.photos.length === 0) return;
  const { count } = await admin
    .from("unit_photos")
    .select("id", { count: "exact", head: true })
    .eq("unit_id", unitId);
  if (count) return;

  for (const [position, src] of row.photos.entries()) {
    let body: Buffer;
    let type: string;
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src);
      type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim();
      if (!res.ok || !Object.values(IMAGE_TYPES).includes(type))
        fail(`line ${row.line}: photo ${src} did not download as an image (${res.status} ${type})`);
      body = Buffer.from(await res.arrayBuffer());
      if (body.length > MAX_PHOTO_BYTES) fail(`line ${row.line}: photo ${src} is over 8 MB`);
    } else {
      body = readFileSync(src);
      type = IMAGE_TYPES[extname(src).toLowerCase()]!;
    }
    const ext = Object.entries(IMAGE_TYPES)
      .find(([, t]) => t === type)![0]
      .replace(".jpeg", ".jpg");
    const path = `${unitId}/${randomUUID()}${ext}`;
    const up = await admin.storage
      .from(BUCKET)
      .upload(path, body, { contentType: type, cacheControl: "31536000" });
    if (up.error) fail(`line ${row.line}: photo upload failed: ${up.error.message}`);
    const { error } = await admin.from("unit_photos").insert({ unit_id: unitId, path, position });
    if (error) fail(`line ${row.line}: ${error.message}`);
  }
}

/** Read back through the public view, as a visitor would, so "imported" means "on the site". */
async function verifyPublic(published: { id: string; row: Row }[]) {
  if (published.length === 0) return;
  const anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } });
  const { data, error } = await anon
    .from("vacant_units_public")
    .select("id, office_id")
    .in(
      "id",
      published.map((p) => p.id),
    );
  if (error) fail(`Imported, but the public check failed: ${error.message}`);
  const officeOf = new Map(data.map((d) => [d.id, d.office_id]));
  const ok = published.filter((p) => officeOf.get(p.id) === office.id).length;
  console.log(`\n${ok} of ${published.length} listings are live under «${office.company_name}»:`);
  for (const p of published) {
    const shown = officeOf.get(p.id);
    const mark =
      shown === office.id ? "✓" : shown ? "✗ shown under ANOTHER office" : "✗ not visible";
    console.log(`  ${mark}  ${SITE}/unit/${p.id}  (${p.row.property} / ${p.row.unit_number})`);
  }
  if (data.some((d) => d.office_id !== office.id))
    console.log(
      "\nApply supabase/migrations/20261016120000_listing_office_from_property.sql (npm run db:push).",
    );
}

// ---------------------------------------------------------------------------------------------------

function writeTemplate(path: string) {
  const book = XLSX.utils.book_new();
  const listings = XLSX.utils.aoa_to_sheet([COLUMNS.map(([h]) => h)]);
  listings["!cols"] = COLUMNS.map(() => ({ wch: 18 }));
  XLSX.utils.book_append_sheet(book, listings, "العروض");
  const help = XLSX.utils.aoa_to_sheet([
    ["العمود", "إلزامي", "القيم المقبولة"],
    ...COLUMNS.map(([h, , req, hint]) => [h, req ? "نعم" : "", hint]),
    [],
    [
      "ملاحظة",
      "",
      "سطر لكل وحدة. الصور: ضعها في مجلد واحد (مجلد فرعي لكل وحدة مثلًا) ومرّر مساره بـ --photos.",
    ],
  ]);
  help["!cols"] = [{ wch: 16 }, { wch: 8 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(book, help, "تعليمات");
  XLSX.writeFile(book, path);
  console.log(`Template written to ${path}`);
}

function printSummary(rows: Row[]) {
  const by = (k: (r: Row) => string) =>
    [...rows.reduce((m, r) => m.set(k(r), (m.get(k(r)) ?? 0) + 1), new Map<string, number>())]
      .map(([v, n]) => `${v} ${n}`)
      .join(" · ");
  console.log(`  purpose:   ${by((r) => (r.purpose === "sale" ? "للبيع" : "للإيجار"))}`);
  console.log(`  districts: ${by((r) => `${r.city}/${r.district}`)}`);
  console.log(`  with photos: ${rows.filter((r) => r.photos.length).length} of ${rows.length}`);
}

function clean(v: unknown): string {
  return String(v ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
function norm(s: string): string {
  return s.replace(/\s+/g, "").replace(/[أإآ]/g, "ا");
}
function toNumber(s: string): number | null {
  const western = s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[,،٬\s]/g, "");
  const n = Number(western);
  return western && Number.isFinite(n) ? n : null;
}
function splitList(s: string): string[] {
  return s
    .split(/[,،;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}
function fail(msg: string): never {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}
