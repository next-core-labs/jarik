# Migration baseline runbook

## Why

The live database is healthy. Lovable applies every file in `supabase/migrations` once, as it
arrives. But the folder can no longer be **replayed from scratch**, which is how you would build a
new environment, a local dev database or a disaster-recovery copy. It contains:

- 5 pairs of identical hand-written files;
- 4 version numbers used by two different files;
- 8 hand-written files that Lovable re-saved under its own name.

Replaying all of them runs each non-idempotent statement twice (`CREATE POLICY`, `CREATE TABLE`, …),
so the replay fails. Run `node scripts/migrations/report.mjs` for the current list.

The fix is a **baseline**: one SQL file exported from the live database that reproduces its schema.
`scripts/migrations/baseline.sh` does the work. Each step is separate, and only one step (B4)
writes to the live database.

## What the export contains

| File                   | Contents                                                                           | Why it's separate                |
| ---------------------- | ---------------------------------------------------------------------------------- | -------------------------------- |
| `00_extensions.sql`    | `CREATE EXTENSION IF NOT EXISTS …` for every installed extension (pg_cron, …)      | not in a schema dump             |
| `01_schema.sql`        | `supabase db dump` of schemas `public` and `private`                               | the bulk                         |
| `02_auth_triggers.sql` | triggers on `auth.users` (e.g. `on_auth_user_created`, which assigns signup roles) | `auth` isn't dumped              |
| `03_storage.sql`       | storage buckets and all storage policies, fully qualified, safe to re-run          | `storage` isn't dumped           |
| `04_cron.sql`          | `cron.schedule(…)` for each job (payment reminders, vacant price decay)            | jobs are rows in `cron.job`      |
| `05_config_data.sql`   | rows of `platform_settings` and `legal_pages`                                      | config a fresh environment needs |

Not carried over: business data, demo rows from the first migration, and runtime counters (invoice
numbers). Change the config list with `CONFIG_TABLES="public.a public.b"`.

## Step 0 — access (needs the project owner)

- **A database connection string with the password.**
  - If the Supabase project is in your own Supabase account: Dashboard → _Connect_ → _Session pooler_
    URI. Percent-encode the password.
  - If Lovable manages the project for you (project `opvbxluwhltseaqokppn`), you may not have this.
    Ask Lovable support for a connection string or a schema dump. Without one, stop here: nothing
    below can run.
- **Docker running.** On this Mac: `colima start`.
- `export SUPABASE_DB_URL='postgresql://postgres.<ref>:<password>@<host>:5432/postgres'`

## Step 1 — let pending migrations land first

The baseline must include everything live, so first let Lovable apply every migration not yet
applied, including `20261003120000_owner_dashboard_scoped_rpcs.sql` and
`20261004100000_owner_access_fixes.sql`. Then pause schema changes (no Lovable prompts that add
migrations) until you finish.

`export` stops if the live migration history doesn't record a local file. If Lovable applies files
without recording them, check in the live database that the changes took effect, then re-run with
`ALLOW_PENDING=1`. For example, this should return `5`:
`select count(*) from pg_proc where proname in ('owner_units', 'owner_finance_summary', 'owner_property_returns', 'owner_pending_approvals', 'owner_offices');`

## Step 2 — export (read-only)

```sh
scripts/migrations/baseline.sh export
```

This writes `supabase/baseline/<timestamp>/`. Before going on, open `baseline.sql` and check two
things:

- it contains no secrets: `05_config_data.sql` holds whatever is in `platform_settings`;
- `04_cron.sql` doesn't embed keys in job commands. If it does, replace them with placeholders.

## Route A — bootstrap file (recommended: no risk to Lovable or the live database)

`supabase/migrations` stays exactly as Lovable has it. The baseline is used only to build **new**
databases.

```sh
# A NEW, empty Supabase database: a fresh project, or `supabase start` locally
# (local, from inside Docker: postgresql://postgres:postgres@host.docker.internal:54322/postgres)
export TARGET_DB_URL='…'
scripts/migrations/baseline.sh bootstrap       # baseline + every migration newer than it
scripts/migrations/baseline.sh verify-target   # diff new vs live: must print no changes
```

Commit `supabase/baseline/<timestamp>/` (after the secrets check), along with this file. Re-export
whenever you want a fresh starting point. Newer migrations are picked up automatically by
`bootstrap`.

## Route B — replace the folder (only after B3)

Do this on a **separate branch**, never the Lovable-connected one, until step B5.

- **B1:** `scripts/migrations/baseline.sh archive`. This moves all 133 files to
  `supabase/migrations_archive/` and adds `supabase/migrations/<ts>_baseline.sql`. It's local only;
  undo with `scripts/migrations/baseline.sh undo-archive`.
- **B2:** `scripts/migrations/baseline.sh verify`. This replays the folder in a shadow database and
  diffs it against live. It must print no changes. If it does, undo and investigate.
- **B3: confirm with Lovable before merging.** Lovable applies files it finds in
  `supabase/migrations`. If it treated `<ts>_baseline.sql` as a new migration, it would run it against
  the live database, and that fails on the first `CREATE TABLE`. Ask Lovable how it tracks applied
  migrations, and whether deleting 133 files and adding one will be applied or ignored. If you can't
  get a clear answer, use Route A.
- **B4:** `scripts/migrations/baseline.sh repair --i-checked-lovable`. This is the **only step that
  writes to the live database**. It edits the migration-history table only: it forgets the archived
  versions and records the baseline as applied. It doesn't touch the schema or any data.
- **B5:** merge the branch.

## Guarding against new duplicates

`node scripts/migrations/report.mjs --strict` exits 1 when there are identical files or a version
number used twice. Lovable's own re-saved copies are reported but don't fail it. It fails today
because of the existing duplicates. After Route B (or once the old files are archived), it can run
in CI.
