#!/usr/bin/env node
// Create (or take back) the platform's single system administrator — «مدير النظام», workspace /hq.
//
//   node scripts/set-system-admin.ts
//
// Asks for a password (input hidden), then: creates the account if it does not exist, or resets the
// password of the one that does (so an account someone else signed up with that address is taken
// back), marks the email confirmed (no mailbox is needed), strips every other role, and grants
// super_admin. Run it again any time to reset the password.
//
// The email is fixed in the database (private.system_admin_email(), migration
// 20261101100000_single_system_admin.sql), which refuses super_admin to any other account; change it
// there in a new migration, then here.
//
// Needs SUPABASE_SERVICE_ROLE_KEY (env or .dev.vars — never commit it). Targets SUPABASE_URL from the
// environment, else .env (the live project).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

export const SYSTEM_ADMIN_EMAIL = "superadmin@jarak.com";
const MIN_PASSWORD = 12;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { url, serviceKey } = loadEnv();
const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

console.log(`System administrator: ${SYSTEM_ADMIN_EMAIL}`);
console.log(`Project: ${url}`);
const password = process.env["SYSTEM_ADMIN_PASSWORD"] || (await askHidden("New password: "));
if (password.length < MIN_PASSWORD)
  fail(`The password must be at least ${MIN_PASSWORD} characters.`);
if (!process.env["SYSTEM_ADMIN_PASSWORD"] && (await askHidden("Repeat it: ")) !== password) {
  fail("The two passwords differ.");
}

const existing = await findUser(SYSTEM_ADMIN_EMAIL);
let userId: string;
if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, {
    password,
    email_confirm: true,
    ban_duration: "none",
  });
  if (error) fail(`Could not reset the password: ${error.message}`);
  userId = existing.id;
  console.log("Account existed — password reset.");
} else {
  const { data, error } = await admin.auth.admin.createUser({
    email: SYSTEM_ADMIN_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { full_name: "مدير النظام" },
  });
  if (error || !data.user) fail(`Could not create the account: ${error?.message}`);
  userId = data.user.id;
  console.log("Account created.");
}

// The platform account is only that: no office, owner or tenant identity mixed into it.
const { error: grantError } = await admin
  .from("user_roles")
  .upsert({ user_id: userId, role: "super_admin" }, { onConflict: "user_id,role" });
if (grantError) fail(`Could not grant مدير النظام: ${grantError.message}`);
const { error: stripError } = await admin
  .from("user_roles")
  .delete()
  .eq("user_id", userId)
  .neq("role", "super_admin");
if (stripError) fail(`Could not remove the account's other roles: ${stripError.message}`);

console.log(`Done. Sign in at /auth with ${SYSTEM_ADMIN_EMAIL} — it opens /hq.`);

// ---------------------------------------------------------------------------------------------------

async function findUser(email: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Could not list accounts: ${error.message}`);
    const hit = data.users.find((u) => u.email?.toLowerCase() === email);
    if (hit) return hit;
    if (data.users.length < 1000) return null;
  }
}

function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) fail("Run it in a terminal, or set SYSTEM_ADMIN_PASSWORD.");
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (ch: string) => {
      if (ch === "\r" || ch === "\n") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.off("data", onData);
        process.stdout.write("\n");
        resolve(value);
      } else if (ch === "\u0003") {
        process.exit(130);
      } else if (ch === "\u007f") {
        value = value.slice(0, -1);
      } else {
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

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
  if (!url) fail("SUPABASE_URL missing from .env");
  if (!serviceKey)
    fail(
      "SUPABASE_SERVICE_ROLE_KEY is not set. Put it in .dev.vars (git-ignored) or run:\n" +
        "  SUPABASE_SERVICE_ROLE_KEY=sb_secret_… node scripts/set-system-admin.ts",
    );
  return { url, serviceKey };
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
