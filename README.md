# AI Creator Studio

A private, self-hosted dashboard for running an AI-assisted creator brand: plan seven videos a week, build prompts, generate or upload media, review and approve the exact final file, schedule, publish (or prepare a manual posting package), and track results.

**Hard guarantee:** nothing is published unless you approved that exact file version. The server re-checks the approval, the file's SHA-256 fingerprint, the destination and your workspace permissions at the moment of publishing, inside a database transaction. Any change to the file voids the approval.

Built with Next.js 16 (App Router, server actions), React 19, TypeScript, Tailwind CSS 4, PostgreSQL and Prisma.

---

## Contents

1. [What works today, and what is simulated](#what-works-today-and-what-is-simulated)
2. [Run it locally](#run-it-locally)
3. [Environment variables](#environment-variables)
4. [How the workflow fits together](#how-the-workflow-fits-together)
5. [Workspaces A and B](#workspaces-a-and-b)
6. [Connecting a real provider](#connecting-a-real-provider)
7. [OnlyFans and other platforms without an API](#onlyfans-and-other-platforms-without-an-api)
8. [Analytics data rules](#analytics-data-rules)
9. [Tests](#tests)
10. [Deploying](#deploying)
11. [Backups and restore](#backups-and-restore)
12. [Production checklist](#production-checklist)
13. [Troubleshooting](#troubleshooting)
14. [Project layout](#project-layout)
15. [Design notes and known limitations](#design-notes-and-known-limitations)

---

## What works today, and what is simulated

| Area | Status |
|---|---|
| Accounts: register, sign in, sign out, forgot/reset password, email verification, TOTP two-factor, session list and revoke, lockout after repeated failures, rate limiting | Working |
| Roles: account owner/admin, per-workspace Manager / Contributor / Reviewer | Working |
| Brand identity, character profiles (21+ only), authorized likeness references with consent records | Working |
| Content studio: concepts, structured prompt builder with mandatory safety negatives, prompt versions | Working |
| Generation queue with retries, idempotency and per-provider capability checks | Working, **with simulated providers only** (no real AI provider is connected) |
| Manual upload of finished videos and thumbnails, validation (file signature + `ffprobe`), immutable versions, private storage | Working (local disk, Postgres, or any S3-compatible bucket) |
| Approval inbox: full preview required, side-by-side version compare, approve / reject / needs revisions with notes, approval invalidated by any new version | Working |
| Weekly calendar (U.S. time zones), drag to reschedule, publish scheduling, retries with backoff, failure notifications | Working |
| Publishing | **Simulated destination** (development) and **manual publishing package** (download + caption + checklist + confirm with the post URL). No real platform API is connected. |
| Analytics | CSV import of real statements (labeled with file name and import date) and clearly labeled **DEMO** data. Nothing is invented; recommendations use only imported real data. |
| Audit log, data export (JSON), account deletion | Working |

Simulated output is a labeled SVG placeholder, is stored with `isSimulated = true`, shows a **SIMULATED** badge everywhere, and can never be sent to a real destination.

---

## Run it locally

### Prerequisites

- **Node.js 22** (20.9+ works)
- **PostgreSQL 14+** (16 tested)
- **ffmpeg** (optional but recommended): `ffprobe` validates uploaded videos. Without it, uploads still work and the version records "ffprobe not installed; video metadata not verified".

### First run

```bash
cd ai-creator-studio
npm install

# 1. Create a database and user (adjust to taste)
createuser -P studio            # password: studio
createdb -O studio ai_creator_studio_dev

# 2. Configure
cp .env.example .env
# Fill in the two keys:
#   APP_ENCRYPTION_KEY=$(openssl rand -hex 32)
#   MEDIA_SIGNING_KEY=$(openssl rand -hex 32)

# 3. Create the tables
npm run db:migrate

# 4. Optional: demo account + one fictional character + a week of non-explicit concepts
npm run db:seed                 # owner@example.com / Studio-Dev-Pass-2026
# or choose your own:
SEED_EMAIL=you@example.com SEED_PASSWORD='Choose-A-Strong-Pass1' npm run db:seed

# 5. Start the web app and the background worker (two terminals)
npm run dev                     # http://localhost:3000
npm run worker:dev              # runs generation jobs, scheduled publishing, retries, reminders
```

`npm run dev:all` starts both in one terminal on macOS/Linux.

The **first account you register becomes the owner** and is added to both workspaces as Manager. After creating your account, set `ALLOW_REGISTRATION="false"`.

Without SMTP, password-reset and verification links are printed to the web server's console.

In development, the Studio's Generate card has a **Process queue now (dev)** button so you can run queued mock jobs without the worker. It is not rendered in production.

### Production build on your machine

```bash
npm run build
npm start          # web on port 3000 (or $PORT)
npm run worker     # background worker
```

---

## Environment variables

All variables are validated at startup (`src/server/env.ts`). Secrets are only read on the server and are never sent to the browser.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string. In production add `?sslmode=require` if your host needs it. |
| `APP_URL` | yes in production | Public base URL, used in email links. Defaults to `RENDER_EXTERNAL_URL` on Render. |
| `APP_ENCRYPTION_KEY` | yes | 32 random bytes as 64 hex chars or base64. AES-256-GCM key for integration credentials and 2FA secrets at rest. **Losing it makes stored credentials and 2FA unreadable.** |
| `MEDIA_SIGNING_KEY` | yes | Same format. Signs 5-minute private media URLs. Rotating it only invalidates links currently open. |
| `ALLOW_REGISTRATION` | no (`true`) | Set `false` once your account exists. |
| `STORAGE_DRIVER` | no (`local`) | `local` (disk), `s3` (any S3-compatible bucket) or `database` (bytes in Postgres, 50 MB per file; for hosts without a disk). |
| `STORAGE_DIR` | no (`./.storage`) | Local driver only. Outside `public/`, never served directly. |
| `S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE` | for `s3` | Any S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO). Objects are written with server-side encryption and read through short-lived presigned URLs. Keep the bucket private. |
| `SMTP_URL` | no | e.g. `smtps://user:pass@smtp.example.com:465`. Empty means emails are logged instead of sent. |
| `EMAIL_FROM` | no | Sender for password reset, verification and alerts. |
| `ENABLE_MOCK_PROVIDERS` | no (`true`) | Shows the simulated generators and destination. **Set `false` in production** once real adapters exist. |
| `WORKER_POLL_MS` | no (`5000`) | How often an idle worker checks the queue. |

`.env.test` holds non-secret keys for the test database only.

---

## How the workflow fits together

1. **Plan** – Content Studio → New concept, or "+ Plan" on a calendar day. A concept is one planned video: scene, wardrobe, lighting, camera, format, caption, hashtags, date/time and U.S. time zone.
2. **Prompt** – The prompt builder assembles a structured prompt from the concept, character and brand profile. Edits save as numbered versions. A mandatory negative prompt (minors, youthful appearance, school settings, real-person likeness and quality artifacts) is always sent and cannot be removed. A safety scanner blocks prompts that mention minors, ages under 18 or impersonation.
3. **Generate or upload** – Submit to a provider (queued, retried with exponential backoff, re-submitting the same prompt never duplicates finished work) or upload a finished file. Every result is a new immutable version with a SHA-256 fingerprint.
4. **Approve** – The Approval inbox requires the full preview (video played to the end, or the image on screen) and a confirmation checkbox before "Approve this version" is enabled. The server re-hashes the stored file at approval time. A new version voids earlier approvals and cancels anything queued.
5. **Schedule** – From the calendar, pick an eligible destination, date, time and time zone. The **first publication to each destination needs an extra confirmation**.
6. **Publish** – The worker (or "Publish now") claims the schedule row with a row lock, re-runs every gate (approval still valid, same SHA-256, file re-hashed, destination allowed for the workspace, simulated media only to the simulated destination), then publishes. Every attempt is written to `PublishAttempt` and the audit log. Failures retry with backoff and notify you.
7. **Manual package** – For destinations without an API, the schedule becomes "Ready to post manually": download the approved file, copy the caption, follow the checklist, post it yourself, then paste the post URL to mark it published.

---

## Workspaces A and B

- **A · Sensual, Fitness & Lifestyle** – available immediately.
- **B · Adult (restricted)** – hidden and locked until you go to Settings → Security, confirm you are 18+ and authorized, and re-enter your password. You can lock it again at any time.

In workspace B, a generator or destination is usable only if **both** its adapter declares that the provider's terms allow adult content **and** you verified that policy for the integration (Settings → Integrations → "Verify provider terms"). Today no generator qualifies, so workspace B supports planning, prompts, manual uploads, review, scheduling and the manual publishing package. All seed data and default templates are non-explicit.

Always enforced, in both workspaces: characters must be fictional adults aged 21+; a real person's face can only be used through a likeness reference with a recorded consent statement, and revoking it blocks further generation; the safety scanner and negative prompt cannot be bypassed.

---

## Connecting a real provider

The app never fakes an integration. A provider appears as connectable only after an adapter exists for it.

1. **Verify the provider first:** official API, content policy (adult content, likeness/reference-image rules), commercial-use rights, rate limits and pricing. Keep a link to the terms.
2. **Write an adapter** implementing `GenerationProvider` or `PublishingDestination` from `src/server/providers/types.ts`. Credentials are passed in per call, decrypted on the server; never read API keys from the browser or store them in code. Set `capabilities.allowsAdultContent` only if the provider's terms explicitly allow it.
3. **Register it** in `src/server/providers/adapters/index.ts` (add it to `generationAdapters` or `publishingAdapters`).
4. **List it** in `INTEGRATION_CATALOG` in `src/server/providers/registry.ts` with the same `providerKey` and `availability: "available"`, so Settings → Integrations shows a credentials form.
5. In the app: Settings → Integrations → save credentials (encrypted with `APP_ENCRYPTION_KEY`; only a masked hint is ever shown), run **Health check**, and open **Verify provider terms** and record your verification. Unverified real providers cannot be used.
6. Add a test next to `tests/integration/generation.test.ts` or `publishing.test.ts` using a fake HTTP layer.

Analytics APIs follow the same pattern with `AnalyticsSource`. Until one exists, import CSV statements.

---

## OnlyFans and other platforms without an API

OnlyFans does not offer a public, officially supported posting API for creators. The app therefore lists it as **No official API** and does not automate the website, scrape it, or store your platform password. Use the **Manual publishing package**: it gives you the approved file (download link verified against the approved fingerprint), caption and hashtags, a checklist, and a field to confirm the post URL after you publish. The same path works for any platform you post to by hand.

---

## Analytics data rules

- **Real data** comes only from imports (Analytics → Import CSV). Each import is labeled with its source file name and import date. The file needs a `date` column (YYYY-MM-DD) plus any of: `profile_visits` (or `visits`), `clicks`, `impressions`, `new_subscribers`, `active_subscribers` (or `subscribers`), `churned_subscribers` (or `churned`, `expired`), `free_to_paid`, `free_followers`, `revenue` (or `net_revenue`, `earnings`; in dollars), `engagements` (or `likes`), `ad_spend` (or `spend`; in dollars).
- **Demo data** can be generated to try the charts. It is labeled **DEMO** on every chart and table, is never mixed with real data, and can be cleared with one click.
- Recommendations use only real imported data and need at least 14 days of it. With less, the page says so instead of guessing.

---

## Tests

```bash
# one-time: create the test database and apply migrations
createdb -O studio ai_creator_studio_test
npm run db:test:prepare

npm test            # unit + integration (Vitest, real PostgreSQL test database)
npm run test:e2e    # browser end-to-end (Playwright, production build on port 3100)
npm run lint
npm run typecheck
```

`npm run test:e2e` builds nothing itself: run `npm run build` first. It needs a Chromium: run `npx playwright install chromium` once, or point `CHROMIUM_PATH` at an existing Chrome/Chromium binary.

Current results: **71 unit/integration tests and 6 end-to-end tests pass.** Coverage includes:

- sign-up, sign-in, lockout, MFA, password reset and session revocation;
- workspace permissions, including the restricted-workspace lock;
- private media access: signed URLs bound to user, version and expiry, plus a live session, path traversal and cross-user denial;
- approval, rejection and needs-revisions, and approval invalidation when a new version is uploaded;
- the publish gate, including concurrent publish attempts where exactly one succeeds, changed-file detection and simulated media blocked from real destinations;
- scheduling, retries with backoff and stuck-job recovery;
- publish failures and manual confirmation;
- credential encryption, masking and redaction from audit logs;
- in the browser: the full flow from prompt through mock generation, full preview, approval, scheduling with first-use confirmation and simulated publish, plus upload, restricted unlock, and every page at phone width with no horizontal scrolling and no page errors.

The test setup refuses to run against a database whose name does not end in `_test`.

---

## Deploying

The app is two processes sharing one PostgreSQL database and one private bucket:

- **both at once**: `npm run start:all` applies migrations, then runs web and worker together, stopping both if either exits (the Docker image default)
- **web**: `npm start` (Next.js server)
- **worker**: `npm run worker` (generation jobs, scheduled publishing, retries, daily reminders). Run exactly one or more; jobs are claimed with `FOR UPDATE SKIP LOCKED`, so several workers are safe.

Serverless-only hosts (e.g. Vercel alone) cannot run the long-lived worker; pair them with a separate worker host or use a platform with background workers.

### Free: one Render service from the included Blueprint

`render.yaml` describes a single Docker web service on Render's free plan (web app and worker in one
container via `npm run start:all`, which also applies migrations on boot). Free services have no disk,
so media bytes are stored in Postgres (`STORAGE_DRIVER=database`, 50 MB per file), and the database is
an external free Postgres such as a Supabase project. Render generates `APP_ENCRYPTION_KEY` and
`MEDIA_SIGNING_KEY` (base64 keys are accepted) and provides the public URL, so `APP_URL` can stay unset
until you add a custom domain.

1. Prepare the database. On Supabase, give the app its own role and schema so it cannot read anything else:
   ```sql
   create role acs_app with login password '<strong password>';
   grant acs_app to postgres;
   create schema studio authorization acs_app;
   revoke all on schema studio from public;
   ```
   Use the **Session pooler** connection (IPv4; Render has no IPv6), port 5432, user `acs_app.<project-ref>`:
   `postgresql://acs_app.<ref>:<password>@aws-N-<region>.pooler.supabase.com:5432/postgres?schema=studio&sslmode=require&connection_limit=3`.
   If the `aws-0`/`aws-1` prefix is wrong, `start:all` retries with the other one.
2. In Render (sign in with GitHub): **New → Blueprint**, pick the repo, paste `DATABASE_URL`, leave
   `SMTP_URL`/`EMAIL_FROM` empty if you have no email provider yet, and apply.
3. When the deploy is live, open the `onrender.com` URL, register (the first account becomes the owner),
   enable 2FA in Settings → Security, then set `ALLOW_REGISTRATION=false` in the service's Environment tab.
4. Copy `APP_ENCRYPTION_KEY` and `MEDIA_SIGNING_KEY` from the Environment tab into a password manager.

Free-plan limits: the service sleeps after 15 idle minutes (the next visit takes about a minute, and the
worker only runs while it is awake, so scheduled jobs run late), Supabase free has 500 MB of database and
pauses after a week without activity. For a steady setup, switch to a paid instance with a disk
(a paid `plan`, a `disk` mounted at `/app/.storage` and `STORAGE_DRIVER=local`) or to R2/S3 as below.

### Scalable: Render (or Railway / Fly.io), with Cloudflare R2 for media

1. **Database** – Create a managed PostgreSQL instance (Render PostgreSQL, Neon, Supabase, RDS…). Enable automated backups.
2. **Bucket** – Create a private Cloudflare R2 (or S3) bucket and an access key scoped to that bucket only. No public access.
3. **Code** – Push this repository to a private GitHub repo.
4. **Web service** (Docker runtime, using the included `Dockerfile`, which installs `ffmpeg` and `openssl`):
   - Start command: `npm start` (the image default, `npm run start:all`, runs web and worker together)
   - Pre-deploy command: `npm run db:deploy` (applies migrations)
   - Health check path: `/api/health`
5. **Background worker** – Same repo and Dockerfile, start command `npm run worker`.
6. **Environment** (both services, from the same secret group): `DATABASE_URL`, `APP_URL=https://your-domain`, `APP_ENCRYPTION_KEY`, `MEDIA_SIGNING_KEY`, `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_REGION=auto` (R2), `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `SMTP_URL`, `EMAIL_FROM`, `ALLOW_REGISTRATION=true` (until your account exists), `ENABLE_MOCK_PROVIDERS=false` once a real adapter is connected.
7. Deploy, open `APP_URL`, register your account (it becomes the owner), enable 2FA, then set `ALLOW_REGISTRATION=false` and redeploy.
8. Add your custom domain; the platform provides HTTPS. The app already sends HSTS, CSP and frame-blocking headers.

Without Docker (Node runtime): build command `npm ci --include=dev && npm run build`, start `npm start`; install `ffmpeg` on the host if you want video validation.

### Docker anywhere

```bash
docker build -t ai-creator-studio .
# simplest: one container runs migrations, web and worker; media on a named volume
docker run -d --env-file .env.production -p 3000:3000 -v studio-storage:/app/.storage ai-creator-studio

# or split, with STORAGE_DRIVER=s3
docker run --rm --env-file .env.production ai-creator-studio npm run db:deploy   # once per release
docker run -d --env-file .env.production -p 3000:3000 ai-creator-studio npm start # web
docker run -d --env-file .env.production ai-creator-studio npm run worker        # worker
```

---

## Backups and restore

- **Database** – Use your host's automated daily backups with point-in-time recovery if offered. Manual backup and restore:
  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > studio-$(date +%F).dump
  pg_restore --clean --no-owner --dbname "$DATABASE_URL" studio-2026-10-17.dump
  ```
- **Media** – Turn on bucket versioning (S3) or object lifecycle retention (R2) and replicate to a second bucket or provider if the content matters. With the local driver, back up `STORAGE_DIR`.
- **Keys** – Store `APP_ENCRYPTION_KEY` and `MEDIA_SIGNING_KEY` in a password manager as well as on the host. A database backup without `APP_ENCRYPTION_KEY` cannot decrypt stored integration credentials or 2FA secrets.
- Test a restore into a scratch database at least once.
- Settings → Security → **Download export** gives you a JSON copy of your account data (no secrets).

---

## Production checklist

- [ ] `NODE_ENV=production` (set by `npm start` and the Dockerfile)
- [ ] Strong, unique `APP_ENCRYPTION_KEY` and `MEDIA_SIGNING_KEY`, stored in a password manager
- [ ] Media storage: a persistent disk with `STORAGE_DRIVER=local` (single service), `STORAGE_DRIVER=database` on a free plan with no disk, or `STORAGE_DRIVER=s3` with a **private** bucket, versioning on, key scoped to that bucket
- [ ] Managed PostgreSQL with automated backups; a restore has been tested
- [ ] Migrations run on every release (`npm run start:all` does it on boot; split setups run `npm run db:deploy`)
- [ ] At least one worker running (`npm run start:all` includes it; split setups run `npm run worker`)
- [ ] `SMTP_URL` configured, and a password reset tested end to end
- [ ] Owner account created, 2FA enabled, `ALLOW_REGISTRATION=false`
- [ ] `ENABLE_MOCK_PROVIDERS=false` once a real provider is connected (otherwise simulated tools stay visible, clearly labeled)
- [ ] Each real provider: terms verified in Settings → Integrations, health check green
- [ ] HTTPS on your domain; `APP_URL` matches it
- [ ] `/api/health` wired to your host's health check and an uptime monitor
- [ ] Do a full dry run: plan → upload → approve → schedule to the manual package → confirm

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Startup error listing environment variables | A required variable is missing or malformed; the message names it. Keys must be 64 hex characters. |
| "Can't reach database server" | Check `DATABASE_URL`, that PostgreSQL is running, and `?sslmode=require` for hosted databases. |
| Generation jobs stay "queued" | The worker is not running. Start `npm run worker` (or use "Process queue now (dev)" in development). |
| Scheduled post did not go out | Check the calendar card for the error and attempt count; check the worker log. Failed posts retry with backoff and then notify you; "Retry" re-runs every check. |
| "Approve" stays disabled | Watch the preview to the end (videos) and tick the confirmation. |
| Can't select workspace B | Settings → Security → unlock with your password. |
| Video upload says metadata not verified | Install `ffmpeg` (provides `ffprobe`). |
| Password reset email never arrives | Without `SMTP_URL` the link is printed in the web server log. |
| Locked out after failed sign-ins | Wait 15 minutes, or reset your password. |
| Media links stop working | Signed links last 5 minutes; reload the page. |

---

## Project layout

```
prisma/schema.prisma            data model (users, workspaces, concepts, assets, approvals, schedules, audit…)
prisma/migrations/              SQL migrations
prisma/seed.ts                  non-explicit demo data (refuses to run in production)
scripts/worker.ts               background worker entry point
src/proxy.ts                    signed-out redirect (every page and action still checks the session)
src/app/(auth)/                 login, MFA, register, forgot/reset password, verify email
src/app/(app)/                  dashboard, studio, approval, calendar, library, analytics, settings/*
src/app/actions/                server actions (thin wrappers over services)
src/app/api/                    media streaming, brand images, health, data export
src/server/services/            business logic: auth, assets, approvals, publishing, generation, analytics…
src/server/workflow/            content state machine, safety rules
src/server/providers/           provider interfaces, mock + manual providers, adapter registry
src/server/media/               private storage (local/S3), validation, signed URLs
src/server/jobs/                job queue and worker loop
src/components/                 UI components
tests/                          unit, integration and Playwright end-to-end tests
```

---

## Design notes and known limitations

- **Authentication** is implemented in-app (database sessions with hashed tokens, bcrypt passwords, TOTP 2FA, lockout and rate limits) rather than with a hosted auth service, so the app runs anywhere with only PostgreSQL. Sessions are httpOnly, SameSite=Lax cookies with a 7-day sliding expiry.
- **Next.js 16** is used because Next.js 15.5's bundled React canary intermittently left form actions stuck on "Saving…" in production builds; on 16.3.8 with React 19.2.8 the same flows pass repeatedly.
- **No real AI generator or social platform is connected.** That needs your accounts, API credentials and a reviewed policy for each provider (see [Connecting a real provider](#connecting-a-real-provider)).
- **Analytics** has no live platform API connection; use CSV imports.
- `npm audit` reports a high-severity advisory in `deepmerge-ts`, used by the Prisma CLI's config loader (migrations only, not request handling). The fix requires Prisma 7, a breaking upgrade left for later.
- Watermarking, automatic captions/subtitles and video editing are not implemented; upload finished files.
- Times are entered in a U.S. time zone per post; the dashboard and lists show the time zone next to each time.
