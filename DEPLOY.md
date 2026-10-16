# Deploy: Supabase + Cloudflare

The whole site — public marketplace and every dashboard (office, owner, tenant, `/hq`) — is one
Cloudflare Worker on **jarak-ksa.com**, backed by the Supabase project **xjbhpdzjboexcynqtrsp**.
Lovable is no longer involved.

Do the steps in order. ✅ = done once; you never repeat it.

---

## Part A — Supabase

### A1. Keys ✅

Supabase dashboard → **Project Settings → API Keys**.

- **Publishable key** (`sb_publishable_…`) → paste it into `.env` in **both** places that say
  `PASTE_YOUR_PUBLISHABLE_KEY_HERE`. It is public by design; `.env` is committed.
- **Secret key** (`sb_secret_…`, or the legacy `service_role` key) → keep it for Cloudflare (B3).
  Never put it in `.env` or in git.

### A2. Create the database ✅

In Terminal, from the project folder:

```bash
supabase login                                   # opens the browser once
supabase link --project-ref xjbhpdzjboexcynqtrsp # asks for the database password
npm run db:push                                  # creates every table, function, policy, bucket
npm run db:types                                 # refreshes src/integrations/supabase/types.ts
```

The database password is under **Project Settings → Database** (reset it there if you don't have it).
If `db:push` stops on a file with an error, nothing is broken — the project is empty; fix that file
and run `npm run db:push` again (it continues from where it stopped).

### A3. Sign-in settings ✅

**Authentication → URL Configuration**

- Site URL: `https://jarak-ksa.com`
- Redirect URLs: `https://jarak-ksa.com/**`, `https://www.jarak-ksa.com/**`,
  `http://localhost:8080/**`

**Authentication → Providers → Email**: keep "Confirm email" on. The site asks for a **6-digit code**
(sign-up and password reset), so leave the OTP length at 6.

**Google sign-in** (optional): **Authentication → Providers → Google** → paste the Client ID and
Secret from Google Cloud Console. In Google Cloud, the authorised redirect URI is
`https://xjbhpdzjboexcynqtrsp.supabase.co/auth/v1/callback`.

### A4. Emails in Arabic, from your domain (after B is live)

The site sends its own branded Arabic emails through **Resend**:

1. resend.com → **Domains** → add `notify.jarak-ksa.com` → add the DNS records it shows in
   Cloudflare (**DNS → Records**) → wait for "Verified".
2. Resend → **API Keys** → create one → Cloudflare secret `RESEND_API_KEY` (B3).
3. Supabase → **Authentication → Hooks → Send Email** → type **HTTPS** →
   URL `https://jarak-ksa.com/api/auth/send-email` → **Generate secret** → copy it (it looks like
   `v1,whsec_…`) → Cloudflare secret `SEND_EMAIL_HOOK_SECRET` → enable the hook.

Until this is done, Supabase sends its own plain English emails (limited to a few per hour), so
sign-up still works for testing.

### A5. Make yourself the platform admin ✅

Sign up on the live site first, then **SQL Editor** → run (with your email):

```sql
insert into public.user_roles (user_id, role)
select id, 'super_admin' from auth.users where email = 'YOUR@EMAIL.com'
on conflict do nothing;
```

That opens `/hq` for you. (A migration does the same for `nawafalmuhayya@gmail.com` — it takes
effect only if that account exists when the migration runs, so run this SQL for any admin.)

### A6. Check

- **Storage**: buckets such as `branding`, `documents` exist.
- **Integrations → Cron**: `smart-payment-reminders` and `vacant-price-decay` are listed.

---

## Part B — Cloudflare

### B1. Put the domain on Cloudflare ✅

`jarak-ksa.com` is registered at GoDaddy; Cloudflare runs its DNS.

1. Cloudflare → **Add a domain** → `jarak-ksa.com` → **Free** plan. In the scanned records, delete the
   GoDaddy parking `A` records (and any `www` CNAME). Copy the two Cloudflare nameservers shown.
2. GoDaddy → **My Products → jarak-ksa.com → DNS → Nameservers → Change** → "I'll use my own
   nameservers" → paste Cloudflare's two → save. Turn **DNSSEC off** in GoDaddy if it is on.
3. Wait until Cloudflare marks the domain **Active** (minutes to a few hours).

The deploy creates the site's DNS records itself (`wrangler.jsonc` → `routes`).

### B2. Deploy

**Option 1 — from your Mac**

```bash
npx wrangler login     # once
npm run deploy         # builds and deploys; attaches jarak-ksa.com + www automatically
```

**Option 2 — automatically on every push to GitHub (recommended)**

Cloudflare → **Workers & Pages → Create → Import a repository** → `next-core-labs/jarik`:

- Build command: `npm run build`
- Deploy command: `npx wrangler deploy --config .output/server/wrangler.json`
- Root directory: `/`

### B3. Secrets ✅

Cloudflare → **Workers & Pages → jarak → Settings → Variables and Secrets** → **Add** → type
**Secret** for each (or `npx wrangler secret put NAME`). Use _Secret_, not _Text_.

| Name                                                              | Value                                                                                                                  |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`                                                    | `https://xjbhpdzjboexcynqtrsp.supabase.co`                                                                             |
| `SUPABASE_PUBLISHABLE_KEY`                                        | publishable key (A1)                                                                                                   |
| `SUPABASE_SERVICE_ROLE_KEY`                                       | secret key (A1)                                                                                                        |
| `APP_URL`                                                         | `https://jarak-ksa.com`                                                                                                |
| `AI_API_KEY`                                                      | Google AI Studio key (aistudio.google.com) — powers rent suggestions, ad text, assistant, WhatsApp triage, voice notes |
| `AI_BASE_URL`, `AI_MODEL`                                         | optional — only to use another OpenAI-compatible provider                                                              |
| `SEND_EMAIL_HOOK_SECRET`                                          | from A4                                                                                                                |
| `RESEND_API_KEY`                                                  | from A4                                                                                                                |
| `EMAIL_FROM`                                                      | optional, default `"جارك" <noreply@notify.jarak-ksa.com>`                                                              |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`               | your existing WhatsApp Cloud API values                                                                                |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` | if you use Twilio                                                                                                      |
| `EJAR_API_BASE_URL`, `EJAR_CLIENT_ID`, `EJAR_CLIENT_SECRET`       | if you use the Ejar integration                                                                                        |

After adding secrets, deploy again (B2) so the Worker picks them up.

### B4. Check the live site

- `https://jarak-ksa.com` opens the marketplace; `/auth` signs up with an emailed code.
- Sign in → the dashboard for your role; `/hq` after A5.
- WhatsApp: the domain changed, so update the webhook URL in Meta (or Twilio) to
  `https://jarak-ksa.com/api/public/whatsapp/<channel>`.

---

## Part C — Mobile apps (Android + iOS)

The apps are Capacitor shells (`capacitor.config.ts`, `android/`, `ios/`) that load
`https://jarak-ksa.com`, so a normal deploy (B2) updates them too. Rebuild and resubmit the store
apps only after a native change: `capacitor.config.ts`, a plugin, permissions, icons
(`assets/logo.png` → `npm run cap:assets`). App ID / bundle ID: `com.jarakksa.app`.

### C1. Google sign-in in the apps

Google doesn't allow sign-in inside an app WebView, so the apps open it in the system browser
and return through the app's URL scheme (`src/lib/native.ts`). In Supabase → Authentication →
URL Configuration → Redirect URLs, add:

```
com.jarakksa.app://auth-callback
```

### C2. Build

| Task                          | Command                                                                     |
| ----------------------------- | --------------------------------------------------------------------------- |
| Copy config/plugins to native | `npm run cap:sync`                                                          |
| Android Studio                | `npm run cap:android` (needs JDK 21 + Android SDK)                          |
| Xcode                         | `npm run cap:ios`                                                           |
| Point a dev build at local    | `CAP_SERVER_URL=http://<your LAN IP>:8080 npm run cap:sync`, then run again |

Store builds: Android Studio → Build → Generate Signed App Bundle (keep the upload keystore safe,
outside the repo); Xcode → set the Team under Signing & Capabilities → Product → Archive. Bump
`versionCode`/`versionName` in `android/app/build.gradle` and the version/build in Xcode each
release.

---

## Day to day

| Task                | Command                                                                             |
| ------------------- | ----------------------------------------------------------------------------------- |
| Run locally         | `npm run dev` → http://localhost:8080 (uses `.env`; server secrets in `.dev.vars`)  |
| Change the database | add a file in `supabase/migrations/`, then `npm run db:push` and `npm run db:types` |
| Deploy              | push to GitHub (Option 2) or `npm run deploy`                                       |
| Mobile apps         | web changes ship with the deploy; native changes need `npm run cap:sync` (Part C)   |
