// Shared helpers for the QA scripts. Reads the public Supabase config from .env and the QA account
// credentials from .env.qa.local (git-ignored via *.local), written by setup.mjs.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

export const ROOT = resolve(import.meta.dirname, "../..");
export const CREDS_FILE = resolve(ROOT, ".env.qa.local");
export const ROLES = ["office", "owner", "tenant", "technician"];

export function readEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const env = readEnvFile(resolve(ROOT, ".env"));
export const SUPABASE_URL = env.VITE_SUPABASE_URL;
export const PUBLISHABLE_KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const PROJECT_REF = env.VITE_SUPABASE_PROJECT_ID;
export const STORAGE_KEY = `sb-${PROJECT_REF}-auth-token`;

export function qaCreds() {
  const c = readEnvFile(CREDS_FILE);
  return Object.fromEntries(
    ROLES.map((r) => [
      r,
      { email: c[`QA_${r.toUpperCase()}_EMAIL`], password: c[`QA_${r.toUpperCase()}_PASSWORD`] },
    ]),
  );
}

export function anonClient() {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Signs in with a QA account and returns { client, session }. */
export async function signIn(role) {
  const { email, password } = qaCreds()[role] ?? {};
  if (!email) throw new Error(`No QA credentials for "${role}" — run: node scripts/qa/setup.mjs`);
  const client = anonClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${role} (${email}): ${error.message}`);
  return { client, session: data.session };
}

/** Service-role client. The key is fetched from the linked Supabase CLI at runtime and never written to disk. */
export function adminClient() {
  const raw = execFileSync(
    "supabase",
    ["projects", "api-keys", "--project-ref", PROJECT_REF, "-o", "json"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  const keys = JSON.parse(raw);
  const key =
    keys.find((k) => k.name === "service_role")?.api_key ??
    keys.find((k) => k.type === "secret")?.api_key;
  if (!key)
    throw new Error("Could not read the service_role key from `supabase projects api-keys`");
  return createClient(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
