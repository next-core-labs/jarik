#!/usr/bin/env node
// Read-only health report for supabase/migrations. Changes nothing.
//
//   node scripts/migrations/report.mjs            # human-readable report
//   node scripts/migrations/report.mjs --strict   # exit 1 on identical copies / version clashes
//
// Why it exists: Lovable re-saves hand-written migrations under its own timestamped UUID name and
// applies that copy, and several hand-written files were committed twice. The live database is
// fine (Lovable applies each file once), but replaying the folder from scratch — a new environment,
// local dev, disaster recovery — fails on the second copy of every non-idempotent statement.
// See supabase/BASELINE.md for the fix.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

const LOVABLE = /^\d{14}_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.sql$/;
// Lovable's copy drops the trailing newline, so compare with trailing whitespace trimmed.
const hashOf = (f) =>
  createHash("md5")
    .update(readFileSync(join(dir, f), "utf8").trimEnd())
    .digest("hex");

const byHash = new Map();
const byVersion = new Map();
for (const f of files) {
  const h = hashOf(f);
  byHash.set(h, [...(byHash.get(h) ?? []), f]);
  const v = f.split("_")[0];
  byVersion.set(v, [...(byVersion.get(v) ?? []), f]);
}

const sameContent = [...byHash.values()].filter((g) => g.length > 1);
const lovableCopies = sameContent.filter(
  (g) => g.some((f) => LOVABLE.test(f)) && g.some((f) => !LOVABLE.test(f)),
);
const handDuplicates = sameContent.filter((g) => !lovableCopies.includes(g));
const versionClashes = [...byVersion.entries()].filter(([, g]) => g.length > 1);

const list = (groups) => groups.map((g) => g.map((f) => `    ${f}`).join("\n")).join("\n\n");

console.log(
  `${files.length} migration files (${files.filter((f) => LOVABLE.test(f)).length} Lovable-named).\n`,
);
console.log(`Identical hand-written copies: ${handDuplicates.length}`);
if (handDuplicates.length) console.log(list(handDuplicates) + "\n");
console.log(`Version numbers used by more than one file: ${versionClashes.length}`);
if (versionClashes.length) console.log(list(versionClashes.map(([, g]) => g)) + "\n");
console.log(
  `Hand-written files re-saved by Lovable (expected, but replayed twice from scratch): ${lovableCopies.length}`,
);
if (lovableCopies.length) console.log(list(lovableCopies) + "\n");

const problems = handDuplicates.length + versionClashes.length;
console.log(
  problems
    ? "Replay from scratch: BROKEN — see supabase/BASELINE.md."
    : "No duplicate files or version clashes.",
);
if (process.argv.includes("--strict") && problems) process.exit(1);
