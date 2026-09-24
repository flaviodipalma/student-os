# Deploying Student OS

The simplest production setup for an early-stage product: one Next.js app, one
managed Postgres, and hosted providers for everything else. No servers to run,
no queues, no file storage.

```
Browser ──HTTPS──> Next.js app (e.g. Vercel)  ──> Supabase: Auth + Postgres
                        │                        (pooler connection, RLS on, no policies)
                        ├──> Anthropic (syllabus reader, Assistant)
                        ├──> Google Calendar API / Microsoft Graph (per-student OAuth)
                        └──> Canvas / Blackboard (feeds or OAuth)
Login: Google / Microsoft / Apple through Supabase Auth
```

| Piece | Recommended | Notes |
| --- | --- | --- |
| App hosting | Vercel (or any Node 20+ host running `npm start`) | Server actions, API routes and pages in one deployment |
| Database + auth | Supabase (a **separate project** from development) | Pro plan for daily backups and point-in-time recovery |
| AI | Anthropic API key | Syllabus import and the Assistant |
| File storage | none | Syllabus PDFs are processed in memory and never stored |
| Background jobs | none | See "Reminders" below |

## Environments

| | development | test | production |
| --- | --- | --- | --- |
| Where | your laptop (`npm run dev`) | Vitest, in-process Postgres (PGlite) | the deployed app |
| `APP_ENV` | unset | unset | `production` |
| Database | the dev Supabase project | in memory, created per test file | the production Supabase project |
| AI | real key, or `*_AI_PROVIDER=mock` | always mocked | real key (mock is refused) |
| Secrets | `.env.local` (never committed) | none needed | the host's secret settings |

`APP_ENV=production` turns on the deployment rules: on startup
(`src/instrumentation.ts`) the server checks its configuration and **refuses to
start** if something is missing or unsafe (e.g. an `http://` or localhost
redirect URI, a mock AI provider, a missing database URL), logging only variable
names. Run the same check any time: `npm run check:env` (add `APP_ENV=production`
for the deployment rules). `npm run build && npm start` on a laptop keeps the
development rules.

Development data never reaches production: the projects are separate,
`npm run db:seed` refuses `NODE_ENV=production`, tests never use a real
database, and there are no demo accounts.

## Environment variables

Full list with explanations: `.env.example`. For production:

| Variable | Required | What |
| --- | --- | --- |
| `APP_ENV` | yes | `production` |
| `SITE_URL` | yes | `https://<your domain>` (no trailing slash): sign-in callbacks |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Public by design (RLS blocks all table access) |
| `DATABASE_URL` | yes | Supabase **transaction pooler** URI (port 6543), server-only |
| `ANTHROPIC_API_KEY` | yes | Server-only; optional `SYLLABUS_AI_MODEL`, `ASSISTANT_AI_MODEL` |
| `LMS_TOKEN_ENCRYPTION_KEY` | for any integration | `openssl rand -base64 32`; **back it up** (losing it = every student reconnects) |
| `GOOGLE_CALENDAR_*`, `OUTLOOK_CALENDAR_*` | optional | Client id, secret, `https://<domain>/api/integrations/<google\|outlook>-calendar/callback` |
| `CANVAS_*`, `BLACKBOARD_*` | optional | OAuth apps (only with a school's approval); calendar feeds need none |

Never give a secret a `NEXT_PUBLIC_` name (the startup check refuses it).

## Database

- **Connections:** the app uses the pooler URI with a small pool per instance
  (`src/server/db/index.ts`: 5 connections, idle ones closed after 20 s, no
  prepared statements, as the pooler requires). Supabase's own statement timeout
  stops runaway queries.
- **Indexes:** every per-student query is indexed by `user_id` (with the date
  column for tasks, events, study sessions, external events and reminders);
  external ids and OAuth connections have unique keys; foreign-key cascades
  (task → reminders/sessions) are indexed.
- **Integrity:** composite foreign keys keep every record inside its owner's
  data; multi-step writes (syllabus import, onboarding, calendar sync) run in
  transactions, so a failure leaves nothing half-saved.

### Migrations

Every schema change is a migration in `./drizzle`; nothing is edited by hand in
production.

```
change src/server/db/schema.ts
→ npm run db:generate            # writes drizzle/NNNN_name.sql; review the SQL
→ npm test                       # the test databases are built from all migrations
→ npm run db:migrate             # apply to the development database; try the app
→ commit the migration with the code
→ before deploying: DATABASE_URL=<production> npm run db:migrate
→ deploy the app
```

- Run production migrations from a trusted machine or CI job with the
  production `DATABASE_URL` (the pooler URI works; the direct connection string
  is also fine for migrations). Drizzle records applied migrations in
  `drizzle.__drizzle_migrations`, so re-running is safe.
- **Deploy order:** migrate first, then deploy code. Keep migrations additive
  (new tables, nullable columns, indexes) so the old code keeps working during
  the deploy.
- **Destructive changes** (dropping a column or table, narrowing a type): take a
  backup first, ship them as their own migration after the code that stopped
  using the data is live (expand → migrate data → contract), and review the SQL
  line by line. `db:generate` output is never applied without reading it.
- There is no command that resets a database, and none should be added.

### Backups (infrastructure; not in this repository)

- Supabase Pro: **daily backups** (7 days kept) and **point-in-time recovery**
  (recommended: at least 7 days).
- Before every destructive migration: a manual backup (`pg_dump` of the public
  schema, stored encrypted outside Supabase).
- **Test a restore** into a scratch project at least once a quarter, and after
  the first launch.
- Back up `LMS_TOKEN_ENCRYPTION_KEY` separately (a password manager or secret
  store): the database backup is useless for integrations without it.

## OAuth and external services (provider-side setup)

Use production credentials and production redirect URLs only; delete localhost
entries from production apps.

- **Supabase Auth:** Site URL = `https://<domain>`; Redirect URLs =
  `https://<domain>/auth/callback` only; email confirmation on; review auth rate
  limits and leaked-password protection. Google / Microsoft / Apple login:
  `docs/authentication.md` (Apple's secret expires every 6 months).
- **Google Calendar / Outlook:** `docs/calendar-integrations.md` (Google consent
  screen verification before public launch; Microsoft client secret expiry).
- **Canvas / Blackboard sign-in:** only with a school's approval
  (`src/server/integrations/lms/README.md`); calendar feeds work without it.
- **Anthropic:** a production key with a spending limit set in the console.

## Monitoring

Implemented in code:

- **Structured logs** (`src/server/log.ts`): one JSON line per event in
  production (`level`, `time`, `scope`, `msg`, safe fields). Secret-looking
  fields are redacted and objects aren't logged. Scopes to alert on: `request`
  (unexpected server errors), `env`, `db`, `health`, `auth`, `assistant-ai`,
  `syllabus-ai`, `calendar:*`, `canvas`, `blackboard`.
- **Every unexpected server error** goes through `onRequestError`
  (`src/instrumentation.ts`) with its route and digest (the digest is shown to
  the student as a reference).
- **Health checks:** `GET /api/health` (liveness: the app runs) and
  `GET /api/health/ready` (readiness: the database answers within 3 s; 503 if
  not). Both return only `ok` / `unavailable`.

To configure on deployment:

- Uptime monitor on `/api/health/ready` (every 1-5 minutes) with alerts.
- Log drain / log search on the host (Vercel log drains, Datadog, Axiom, …), with
  alerts on `level=error` rates and on `scope=request`.
- Error tracking (optional, e.g. Sentry): report from `onRequestError`, sending
  only the route, digest and error type, never messages or request bodies.
- Slow requests and resource usage: the host's request metrics and Supabase's
  database reports (slow queries, connections).
- Anthropic usage and spend alerts in the Anthropic console.

## Reminders (no background jobs)

Reminders are created when a student has Student OS open (on load, every minute,
and right after their data changes) and are shown in the app and, if allowed, as
desktop notifications from that tab. Nothing runs while no one is using the app:
a reminder that came due while it was closed appears the next time it opens
(deduplicated, and stale "coming up" ones are dropped). Email or push reminders
would need a scheduled job (e.g. a cron hitting a protected endpoint) and are
not built.

## Deploying

1. Create the production Supabase project (Pro), enable backups/PITR, set Auth
   URLs and providers.
2. Set the environment variables on the host (above); `APP_ENV=production`.
3. `APP_ENV=production npm run check:env` with the production values (from a
   trusted machine) until it reports no errors.
4. `DATABASE_URL=<production> npm run db:migrate`.
5. Deploy: the host runs `npm ci && npm run build`, then `npm start` (Vercel does
   this automatically).
6. Check: `/api/health/ready` returns `ok`; sign up with a real email, finish
   onboarding, add a course and a task, open the Planner, ask the Assistant a
   question, import a syllabus; connect an integration if configured.
7. Turn on uptime and error alerts.

Run the production build locally: `npm run build && npm start` (uses `.env.local`,
development rules).

## Production checklist

Legend: **code** = implemented in this repository; **infra** = must be configured
on the deployment / provider side.

| Item | Where | Status |
| --- | --- | --- |
| Production environment configured (`APP_ENV`, `SITE_URL`) | infra | to do |
| Startup configuration check refuses unsafe settings | code | done |
| Secrets in the host's secret store; none in the repo | infra (+ code: none committed) | to do on host |
| Production database (separate Supabase project) | infra | to do |
| Migrations tested (every migration builds the test databases; no drift) | code | done |
| Production migration run before deploy | infra | to do |
| Backups + point-in-time recovery; restore tested | infra | to do |
| HTTPS (host) + HSTS / upgrade-insecure-requests | infra + code | headers done; HTTPS on host |
| OAuth production URLs (Supabase, Google, Microsoft, Apple, calendars) | infra | to do |
| AI provider key with a spending limit | infra | to do |
| Error monitoring (hook in `onRequestError`) | code + infra | hook done; service to configure |
| Structured, redacted logging | code | done |
| Log search / alerts | infra | to do |
| Health checks (`/api/health`, `/api/health/ready`) | code | done |
| Uptime monitor on readiness | infra | to do |
| Rate limiting (per instance) | code | done |
| Shared rate limiting across instances / WAF | infra | to do if scaling out |
| Security headers (CSP, frame, nosniff, …) | code | done |
| Production build succeeds | code | done |
| Authentication, authorization, Planner, Calendar, Notifications tested | code (automated + browser) | done |
| External integrations tested with real accounts | infra | needs provider credentials |
| AI failure tested (the rest of the app keeps working) | code | done |
| Database failure behavior (readiness 503, friendly pages) | code | done |
| Recovery procedures documented (backups, restore, key backup) | docs | done |
