#!/usr/bin/env bash
# Squash supabase/migrations into one baseline exported from the LIVE database.
# Runbook (read it first): supabase/BASELINE.md
#
#   export          read-only on the live DB: dumps schema + the pieces a schema dump misses
#
# Route A — baseline as a bootstrap file; supabase/migrations stays exactly as Lovable has it:
#   bootstrap       builds a NEW, empty Supabase database (TARGET_DB_URL) from the baseline plus
#                   every migration newer than it
#   verify-target   read-only: diffs that new database against the live one
#
# Route B — the baseline replaces the folder (only after BASELINE.md step B3, the Lovable check):
#   archive [DIR]   local files only: moves old migrations to supabase/migrations_archive/
#   verify          read-only on the live DB: replays the folder in a shadow DB and diffs it
#   undo-archive    local files only: puts the old migrations back (before `repair` only)
#   repair --i-checked-lovable
#                   WRITES the live migration-history table: forgets the archived versions,
#                   records the baseline as applied. The only step that changes the live DB.
#
# Needs: SUPABASE_DB_URL (percent-encoded Postgres URL with the database password),
#        the Supabase CLI, and a running Docker (pg_dump/psql run in the postgres:17 image).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MIG="$ROOT/supabase/migrations"
ARCHIVE="$ROOT/supabase/migrations_archive"
BASE="$ROOT/supabase/baseline"
PG_IMAGE="${PG_IMAGE:-postgres:17}"
# Tables whose rows a fresh environment needs (config, not business data). The first migration's
# demo rows and runtime counters are deliberately NOT carried over.
CONFIG_TABLES="${CONFIG_TABLES:-public.platform_settings public.legal_pages}"

die() { echo "error: $*" >&2; exit 1; }
need_db() { [ -n "${SUPABASE_DB_URL:-}" ] || die "set SUPABASE_DB_URL (see supabase/BASELINE.md, step 0)"; }
need_docker() { docker info >/dev/null 2>&1 || die "Docker is not running (on this Mac: colima start)"; }
# Empty search_path: pg_get_triggerdef() and pg_policies print names unqualified when the session
# can already see them (EXECUTE FUNCTION handle_new_user()). The pg_dump part of the baseline clears
# search_path, so an unqualified name would fail on replay. -q keeps the SET tag out of the output.
psql_q() {
  { printf "SET search_path = '';\n"; cat; } |
    docker run --rm -i "$PG_IMAGE" psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -q -At -f -
}
latest_dir() { ls -d "$BASE"/*/ 2>/dev/null | sort | tail -1 | sed 's:/$::'; }

cmd_export() {
  need_db; need_docker
  local ts out
  ts="$(date -u +%Y%m%d%H%M%S)"
  out="$BASE/$ts"
  mkdir -p "$out"

  echo "• migration history on the live DB"
  supabase migration list --db-url "$SUPABASE_DB_URL" > "$out/remote_history.txt"
  # Rows with a local version but no remote one = files the live DB has not recorded as applied.
  local pending
  pending="$(awk -F'|' 'NR>2 { l=$1; r=$2; gsub(/ /,"",l); gsub(/ /,"",r); if (l ~ /^[0-9]+$/ && r == "") print l }' "$out/remote_history.txt")"
  if [ -n "$pending" ] && [ "${ALLOW_PENDING:-0}" != 1 ]; then
    echo "$pending" | sed 's/^/    not recorded live: /'
    die "apply these first (or, if Lovable applies migrations without recording them, re-run with ALLOW_PENDING=1 after confirming in the live DB that they took effect — BASELINE.md step 1)"
  fi

  echo "• extensions"
  psql_q > "$out/00_extensions.sql" <<'SQL'
SELECT format('CREATE EXTENSION IF NOT EXISTS %I WITH SCHEMA %I;', e.extname, n.nspname)
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname <> 'plpgsql' ORDER BY e.extname;
SQL

  echo "• schemas public + private"
  supabase db dump --db-url "$SUPABASE_DB_URL" -s public,private -f "$out/01_schema.sql"

  echo "• triggers on auth.users (outside the dumped schemas)"
  psql_q > "$out/02_auth_triggers.sql" <<'SQL'
SELECT format('DROP TRIGGER IF EXISTS %I ON auth.users;', t.tgname) || E'\n' || pg_get_triggerdef(t.oid) || ';'
FROM pg_trigger t WHERE t.tgrelid = 'auth.users'::regclass AND NOT t.tgisinternal ORDER BY t.tgname;
SQL

  echo "• storage buckets + policies"
  psql_q > "$out/03_storage.sql" <<'SQL'
SELECT format('INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES (%L, %L, %L, %L, %L) ON CONFLICT (id) DO NOTHING;',
              id, name, public, file_size_limit, allowed_mime_types)
FROM storage.buckets ORDER BY id;
SELECT format('DROP POLICY IF EXISTS %I ON %I.%I;', policyname, schemaname, tablename) || E'\n' ||
       format('CREATE POLICY %I ON %I.%I AS %s FOR %s TO %s', policyname, schemaname, tablename, permissive, cmd,
              (SELECT string_agg(quote_ident(r), ', ') FROM unnest(roles) r))
       || COALESCE(' USING (' || qual || ')', '') || COALESCE(' WITH CHECK (' || with_check || ')', '') || ';'
FROM pg_policies WHERE schemaname = 'storage' ORDER BY tablename, policyname;
SQL

  echo "• cron jobs"
  psql_q > "$out/04_cron.sql" <<'SQL'
SELECT CASE WHEN jobname IS NULL THEN format('SELECT cron.schedule(%L, %L);', schedule, command)
            ELSE format('SELECT cron.schedule(%L, %L, %L);', jobname, schedule, command) END
FROM cron.job ORDER BY jobid;
SQL

  echo "• config rows: $CONFIG_TABLES"
  local targs=()
  for t in $CONFIG_TABLES; do targs+=(-t "$t"); done
  docker run --rm "$PG_IMAGE" pg_dump "$SUPABASE_DB_URL" --data-only --column-inserts --no-owner "${targs[@]}" \
    > "$out/05_config_data.sql"

  {
    echo "-- Baseline exported from the live database at $ts (UTC) by scripts/migrations/baseline.sh."
    echo "-- Replaces every migration archived in supabase/migrations_archive/. See supabase/BASELINE.md."
    for f in 00_extensions 01_schema 02_auth_triggers 03_storage 04_cron 05_config_data; do
      printf '\n-- ===== %s =====\n' "$f"
      cat "$out/$f.sql"
    done
  } > "$out/baseline.sql"

  echo
  echo "Exported to ${out#$ROOT/}/baseline.sql ($(wc -l < "$out/baseline.sql") lines). Nothing was changed."
  echo "Review it, then: scripts/migrations/baseline.sh archive"
}

cmd_archive() {
  local out="${1:-$(latest_dir)}"
  [ -n "$out" ] && [ -f "$out/baseline.sql" ] || die "no exported baseline found — run export first"
  if [ -d "$ARCHIVE" ] && [ -n "$(ls -A "$ARCHIVE" 2>/dev/null)" ]; then
    die "supabase/migrations_archive/ is not empty — already archived?"
  fi
  local ts; ts="$(basename "$out")"
  local newer
  newer="$(ls "$MIG" | awk -F_ -v ts="$ts" '$1 > ts')"
  [ -z "$newer" ] || die "migrations newer than the export exist ($newer) — re-export so the baseline includes them"

  mkdir -p "$ARCHIVE"
  mv "$MIG"/*.sql "$ARCHIVE"/
  cp "$out/baseline.sql" "$MIG/${ts}_baseline.sql"
  echo "Archived $(ls "$ARCHIVE" | wc -l | tr -d ' ') files to supabase/migrations_archive/."
  echo "Created supabase/migrations/${ts}_baseline.sql. Live DB untouched."
  echo "Next: scripts/migrations/baseline.sh verify   (undo: scripts/migrations/baseline.sh undo-archive)"
}

cmd_undo_archive() {
  [ -d "$ARCHIVE" ] || die "nothing archived"
  local baseline
  baseline="$(ls "$MIG"/*_baseline.sql 2>/dev/null | head -1 || true)"
  [ -n "$baseline" ] && rm "$baseline"
  mv "$ARCHIVE"/*.sql "$MIG"/
  rmdir "$ARCHIVE"
  echo "Restored the original migrations. Live DB untouched."
}

cmd_verify() {
  need_db; need_docker
  echo "• replaying supabase/migrations in a shadow DB and diffing against the live DB (read-only)…"
  local diff
  diff="$(supabase db diff --db-url "$SUPABASE_DB_URL" -s public,private 2>&1 | tee /dev/stderr)"
  if grep -qiE '^\s*(create|alter|drop|grant|revoke|comment)\b' <<<"$diff"; then
    die "the folder does not reproduce the live schema — see the diff above"
  fi
  echo
  echo "OK: a fresh replay of supabase/migrations matches the live schema (public, private)."
}

cmd_bootstrap() {
  need_docker
  [ -n "${TARGET_DB_URL:-}" ] || die "set TARGET_DB_URL to the NEW database to build (never the live one)"
  [ "${TARGET_DB_URL}" != "${SUPABASE_DB_URL:-}" ] || die "TARGET_DB_URL is the live database"
  local out ts
  out="$(latest_dir)"
  [ -n "$out" ] && [ -f "$out/baseline.sql" ] || die "no exported baseline found — run export first"
  ts="$(basename "$out")"
  local files=("$out/baseline.sql")
  local f
  for f in $(ls "$MIG" | sort); do
    [ "${f%%_*}" \> "$ts" ] && files+=("$MIG/$f")
  done
  for f in "${files[@]}"; do
    echo "• ${f#$ROOT/}"
    docker run --rm -i "$PG_IMAGE" psql "$TARGET_DB_URL" -v ON_ERROR_STOP=1 -q -f - < "$f"
  done
  echo
  echo "Built the target from the $ts baseline + $((${#files[@]} - 1)) newer migration(s)."
  echo "Next: scripts/migrations/baseline.sh verify-target"
}

cmd_verify_target() {
  need_db; need_docker
  [ -n "${TARGET_DB_URL:-}" ] || die "set TARGET_DB_URL to the database built by bootstrap"
  local diff
  diff="$(supabase db diff --from "$TARGET_DB_URL" --to "$SUPABASE_DB_URL" -s public,private 2>&1 | tee /dev/stderr)"
  if grep -qiE '^\s*(create|alter|drop|grant|revoke|comment)\b' <<<"$diff"; then
    die "the bootstrapped database differs from the live schema — see the diff above"
  fi
  echo
  echo "OK: baseline + newer migrations reproduce the live schema (public, private)."
}

cmd_repair() {
  need_db
  [ "${1:-}" = "--i-checked-lovable" ] || die "this rewrites the live migration-history table; read BASELINE.md step 5, then pass --i-checked-lovable"
  local baseline ts versions
  baseline="$(ls "$MIG"/*_baseline.sql 2>/dev/null | head -1 || true)"
  [ -n "$baseline" ] || die "no baseline in supabase/migrations — run archive first"
  ts="$(basename "$baseline" | cut -d_ -f1)"
  versions="$(ls "$ARCHIVE" | cut -d_ -f1 | sort -u | tr '\n' ' ')"
  echo "• forgetting $(wc -w <<<"$versions" | tr -d ' ') archived versions in the live history"
  # shellcheck disable=SC2086
  supabase migration repair --db-url "$SUPABASE_DB_URL" --status reverted $versions
  echo "• recording baseline $ts as applied"
  supabase migration repair --db-url "$SUPABASE_DB_URL" --status applied "$ts"
  supabase migration list --db-url "$SUPABASE_DB_URL"
}

case "${1:-}" in
  export) cmd_export ;;
  archive) shift; cmd_archive "${1:-}" ;;
  undo-archive) cmd_undo_archive ;;
  verify) cmd_verify ;;
  bootstrap) cmd_bootstrap ;;
  verify-target) cmd_verify_target ;;
  repair) shift; cmd_repair "${1:-}" ;;
  *) sed -n '2,24p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
