# Security and privacy

How Student OS protects student data, and what must be in place before real
users. Details for each area live next to the code (linked below).

## Authentication

- **Supabase Auth** (email + password, Google, Microsoft, Apple). Sessions are
  Supabase's signed JWTs in cookies, refreshed by `src/proxy.ts`.
- **Every server entry point checks the session itself**, never the proxy alone:
  `runAction` (`src/server/actions.ts`) for server actions, `getCurrentUser()` /
  `requireUser()` (`src/server/auth.ts`, `getClaims()` verifies the signature) for
  pages and API routes. The user id always comes from the verified session; no
  action or route accepts a user id from the browser.
- Redirects after sign-in only go to in-app paths (`safeNextPath`).
- **The browser extension** (`extension/`) uses the same login: Chrome sends the
  Student OS session cookies with the extension's requests because it has
  permission for the Student OS address. Its endpoints (`/api/extension/*`) check
  the session like everything else and also require the extension
  (`src/server/integrations/extension/http.ts`): the `X-Student-OS-Extension`
  header (a website can't add it to a cross-site request: no CORS headers are
  sent), and an Origin, when present, of a Chrome extension (in production, only
  the ids in `STUDENT_OS_EXTENSION_IDS`). Chrome omits Origin on the extension's
  GETs, so a missing Origin is accepted only for GET; a website's POST always has
  one. With the SameSite=Lax cookies, other websites can't use a student's login
  here (checked in a real browser from another site: blocked or 403, nothing
  written).
- Social login and account linking: `docs/authentication.md` (Supabase's PKCE +
  state; automatic linking only between verified emails; manual linking only for
  a signed-in student).

## Authorization and user isolation

- **Services** (`src/server/services`, `src/server/integrations`) take the
  session's `userId` and filter every read and write by it. Another student's id
  gets the same "not found" as a missing one (no probing).
- **The database enforces ownership too**: composite foreign keys tie a task to
  its course, a study session to its task and a reminder to its task **for the
  same user** (`(id, user_id)`), so a record can't point into another student's
  data even if a service had a bug. Every table cascades from the user's profile.
- **Row Level Security** is on for every table with **no policies**: the public
  Supabase key (the only key in the browser) can read and write nothing (checked
  against the live database). The app connects with the server-only
  `DATABASE_URL`.
- Server-only code is marked `import "server-only"` (services, Assistant,
  integrations, auth, database), so it can't be bundled into the browser.

## Input validation

- Every server action parses its input with zod (`src/lib/validation.ts`,
  per-feature schemas) before any service runs; unknown fields are dropped (no
  mass assignment), ids must be UUIDs, dates/times have fixed formats, lengths
  are capped. Database CHECK constraints repeat the important rules.
- AI tool arguments are validated with the tool's zod schema; confirmed
  Assistant changes are parsed again and re-checked against fresh data.

## Files: syllabus upload (`src/app/api/syllabus/extract`)

- Signed-in students only; rate limited (10 per hour per student).
- Size: 10 MB, enforced while reading the body (a request without
  Content-Length can't make the server buffer more), PDFs only (`%PDF-` header),
  at most 100 pages (checked before extracting text), at most 150,000 characters
  of text.
- Held in memory for the request only: the PDF and its text are **never stored**
  (the import history keeps the file name and counts). Nothing is executed; the
  extracted text is data sent to the AI model and validated afterwards.

## AI: the Assistant and the syllabus reader

- **The AI is never an authorization layer.** Assistant tools read only the data
  loaded for the session's user; there are no delete tools; every change is a
  proposal the student must confirm, and Confirm re-validates it (ownership,
  schema, free time) server-side (`src/server/assistant/README.md`).
- **Prompt injection:** task/course/event/syllabus/LMS text is untrusted data:
  flattened and length-capped (`untrusted()`), sent as JSON values, and the
  system prompt says tool data is never instructions. Even a model that "obeys"
  injected text can only propose one change the student sees.
- **Data sent to the provider (Anthropic):** for the Assistant, the rules, a
  short context (date, time zone, the task being discussed), the last 12
  messages (text only) and the results of the tools the model asks for (only what
  the question needs); for syllabus import, the syllabus text. No credentials,
  tokens, emails or other students' data. Conversations are kept only in the
  browser tab (sessionStorage), not on the server.
- Rate limited: 20 Assistant messages per minute and 300 per day per student.

## OAuth and credentials

- **Calendar/LMS OAuth** (Google Calendar, Outlook, Canvas, Blackboard): random
  single-use `state` + PKCE verifier in an encrypted HttpOnly cookie on the
  callback path, bound to the student and provider, 10 minutes; code exchanged on
  the server; redirect URI and secret from server config.
- **Tokens and feed links** are encrypted with AES-256-GCM
  (`LMS_TOKEN_ENCRYPTION_KEY`), bound to `<user id>:<provider>`, decrypted only on
  the server for a sync/disconnect, sent only in `Authorization` headers to the
  provider's own hosts. Never returned to the browser, put in URLs, stored in the
  browser or logged. Disconnecting deletes them (Google tokens are also revoked).
- **Login providers**: secrets live in Supabase; Student OS stores no provider
  tokens for login.
- **Browser extension**: stores nothing secret. The student's Canvas login stays in
  their browser (the extension reads Canvas in the Canvas tab); the extension keeps
  only the Student OS address and the chosen course ids. It reads only the Canvas
  fields Student OS uses (no grades or scores), and the server validates all of it
  like an OAuth sync (same-host links, size limits). The school's address may be any
  public HTTPS address (schools run Canvas and Blackboard on their own domains): unlike
  OAuth, where the server sends secrets to it and only allowlisted hosts are accepted,
  an extension import never makes the server contact it. No IPs, ports or local names.
  Automatic sync is opt-in and asks Chrome for access to the student's Canvas address
  only (never all sites); turning it off gives that access back.
- External links (Open in Canvas / Google / Outlook) must be `https` (and, when
  synced, on the provider's own host); reminder links must be in-app paths (a
  database constraint).

## Browser protections (`next.config.ts`)

Content-Security-Policy (`default-src 'self'`, no plugins, no framing,
`connect-src 'self'`: the browser only talks to Student OS), X-Frame-Options
DENY, nosniff, strict-origin-when-cross-origin referrers, a restrictive
Permissions-Policy, COOP same-origin, and in production HSTS and
upgrade-insecure-requests. `form-action` is intentionally not set (OAuth sign-ins
end in redirects to the providers). Server actions are protected by Next's
built-in Origin check (CSRF); cookies are HttpOnly (auth, OAuth state) and
SameSite=Lax; the theme cookie holds only "light/dark/system".

## Logging and errors

Logs carry error *types*, codes, providers and sizes only: never tokens,
passwords, event contents, syllabus text, AI conversations or database
credentials. Students see fixed, friendly messages; database and provider errors
are mapped (`src/server/errors.ts`) and never returned raw.

## Data kept (privacy)

| Data | Why | Where | Sent to AI |
| --- | --- | --- | --- |
| Account (email, name, term, year) | sign-in, greetings | Supabase Auth, `profiles` | no (the Assistant gets no email) |
| Courses, tasks, events, weekly commitments, study sessions, preferences | the product | own tables, per student | only the parts a question needs |
| External calendar events (Canvas, Blackboard, Google, Outlook) | busy time | `external_calendar_events` (Google/Outlook deleted on disconnect) | only if a question needs them |
| Integration credentials | syncing | encrypted in `lms_connections` / `calendar_connections` | never |
| Reminders | notifications | `notifications` (read/dismissed ones deleted after 60 days) | a reminder's text, if asked |
| Syllabus PDF / text | extraction | **not stored** (import history: file name + counts) | the text, once, for extraction |
| Assistant conversation | follow-ups | the browser tab only | the last 12 messages |

## Rate limits (`src/server/rate-limit.ts`)

Assistant (20/min, 300/day), syllabus import (10/hour), Sync now for any
integration, including the browser extension's imports (20/hour), per student, in
server memory. Login, sign-up and
password reset are limited by Supabase Auth.

## Production checklist (not done in development)

- HTTPS everywhere; set `SITE_URL`; HSTS is sent automatically in production.
- Real, unique secrets in the host's secret store (never in the repo):
  `DATABASE_URL`, `ANTHROPIC_API_KEY`, `LMS_TOKEN_ENCRYPTION_KEY` (32 random bytes,
  backed up: losing it means everyone reconnects), OAuth client secrets. Rotate
  anything that was ever shared.
- Supabase: production project, Site URL + Redirect URLs for the real domain
  only, email confirmation on, leaked-password protection and auth rate limits
  reviewed, database backups / point-in-time recovery on.
- OAuth apps: production redirect URIs only; Google consent screen verified;
  Microsoft/Apple secrets' expiry dates tracked.
- Browser extension: publish it, then set `STUDENT_OS_EXTENSION_IDS` to its id so
  only it can use a student's login (the config check warns in production until
  it's set). Point its default address at the production domain.
- **Rate limiting across instances**: the in-memory limiter is per server; with
  several instances use a shared store (Redis) or the platform's WAF/rate limiting.
- Error reporting and monitoring that respect the logging policy (no payloads).
- Periodic `npm audit` (production dependencies: 0 known issues; 4 moderate
  dev-only findings in `drizzle-kit`'s bundled esbuild, which only affect
  esbuild's own dev server and aren't used).
- Consider a nonce-based CSP (removes `'unsafe-inline'` for scripts) once pages
  can all be rendered dynamically.
