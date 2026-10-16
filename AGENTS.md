Hosting: Cloudflare Workers (`npm run deploy`, config in `wrangler.jsonc`). Database/auth/storage:
Supabase project `xjbhpdzjboexcynqtrsp`; schema changes go in `supabase/migrations` and are applied
with `npm run db:push`, then `npm run db:types`. Setup and secrets: `DEPLOY.md`.

- Keep `/hq` as the platform team's separate workspace: authorize the super-admin or a delegated `hq_admins` permission in the authenticated route gate, and show only platform navigation there; office admin status alone never grants access.
- Generate public listing and office JSON-LD from the same published page data in leaf route heads so search metadata cannot disclose private or stale records.
