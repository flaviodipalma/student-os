# LMS integrations (Canvas, Blackboard)

**Status:** Canvas is implemented (OAuth 2.0 + read-only REST API).
Blackboard is not: its adapter makes no network calls and throws
`LmsNotAvailableError`; Settings shows it as "coming soon".

## Layers

```
Canvas API ──> CanvasProvider ──┐
                                 ├─> LmsProvider (provider.ts) ──> syncLms (sync.ts) ──> normal Student OS courses & tasks
Blackboard API ─> BlackboardProvider ┘        normalized data              planCourses / planTasks
                                              (src/lib/lms/types.ts)       (src/lib/lms/sync-plan.ts)
```

| File | Job |
| --- | --- |
| `src/lib/lms/types.ts` | Normalized `LmsCourse`, `LmsAssignment`, `LmsSyncResult` (shared, no secrets) |
| `src/lib/lms/sync-plan.ts` | Pure matching, mapping and the three-way conflict rule |
| `provider.ts` | The `LmsProvider` contract every adapter implements (OAuth + read) |
| `canvas/` | Canvas adapter: `config.ts` (settings, address check), `oauth.ts`, `api-client.ts` (pagination, errors), `mapping.ts`, `canvas-provider.ts` |
| `blackboard/` | Blackboard adapter (not implemented yet) |
| `token-service.ts` | The only code that decrypts, refreshes and re-stores tokens (`LmsAccess`) |
| `oauth-state.ts` | Single-use OAuth `state` in an encrypted HttpOnly cookie (CSRF protection) |
| `registry.ts` | Picks the adapter for a provider id |
| `credential-vault.ts` | AES-256-GCM encryption of stored tokens |
| `connections.ts` | A student's connections: save (encrypted), status (no tokens), disconnect |
| `sync.ts` | The sync service: fetch -> plan -> save in one transaction -> summary |

Everything under `src/server` is `server-only`: it can't be bundled into the
browser. Nothing outside this folder imports an adapter; the Planner, Dashboard,
Tasks and Courses only ever see normal courses and tasks.

## Mapping

- LMS course -> Student OS **course** (one per LMS course, per student)
- LMS assignment -> Student OS **task** (the same `tasks` table the syllabus importer fills)

Imported records carry `external_source` (`canvas` | `blackboard`),
`external_id`, `external_url`, and `external_synced` (the values last synced).
A unique key on `(user_id, external_source, external_id)` means one record per
LMS item per student; two students importing the same course get separate rows.

## Sync behaviour (src/lib/lms/sync-plan.ts)

Matching, in order: by source + external id; else an existing unlinked record
using the syllabus importer's duplicate rules (course code; same course + due
date + similar title or same type), which is **linked** rather than duplicated;
else **created**.

| Field | Owner |
| --- | --- |
| title, description, due date, due time (course: code, name, professor, description) | synced from the LMS |
| type, estimate | set once when created (estimate: the LMS's if stated, else the importer's default) |
| priority, status, planned date, study sessions | always the student's |

Submitting in the LMS never completes the task in Student OS.

**Conflicts (three-way):** base = `external_synced`, local = the task now,
remote = the LMS now. LMS-only changes are applied; student-only changes are
kept; if both changed a field, the student's value is kept, the conflict is
reported in `LmsSyncResult.conflicts`, and the base moves to the LMS value (so
it isn't re-reported until the LMS changes it again).

**Deleted in the LMS:** never deleted in Student OS automatically. Such tasks
are counted in `assignmentsMissing` for the student to review.

**No due date:** not imported (every task needs one); counted as skipped.

## Security review

- Connections use OAuth 2.0 only. No LMS passwords are asked for or stored; no scraping or browser automation.
- Tokens are encrypted (AES-256-GCM, key `LMS_TOKEN_ENCRYPTION_KEY`) and bound to
  `<user id>:<provider>`, so a copied ciphertext won't decrypt for another student.
  Without the key, tokens can't be stored at all (no plain-text fallback).
- Tokens are decrypted only on the server: by the token service during a sync, and
  by disconnect (to revoke). They're sent to the LMS only in the Authorization
  header, and never returned from a server action, rendered, put in URLs or logged
  (only error *types* are logged).
- The OAuth `state` is random, single-use, bound to the signed-in student, checked
  in constant time and expires after 10 minutes. The redirect URI and client secret
  come from server config, never the request.
- The student-entered Canvas address is validated against an allowlist before the
  client secret is ever sent to it (HTTPS only; no IPs, ports or credentials).
  Pagination links and "Open in Canvas" links are only followed/kept on that same host,
  and redirects are never followed with a token or secret.
  `LmsConnectionSummary` (what the UI gets) has no tokens or LMS ids.
- Every query filters by the signed-in student's id (from the session). External
  ids are only looked up within that student's rows, so they can't reach
  another student's records. Writes go through the normal course/task services.
- Sync errors store and return only safe messages; provider errors (which can
  contain URLs or tokens) aren't passed on.
- Provider secrets are server-only env vars (no `NEXT_PUBLIC_`), names only in `.env.example`.
- The `lms_connections` table has Row Level Security on with no policies, like every table.

## Canvas

Two ways to connect, one sync. Both read the same Canvas course and
assignment ids, so a student can start with the feed and switch to a sign-in
later without duplicates (saving one replaces the other on the connection).

| | Calendar feed (default) | Sign in with Canvas (OAuth) |
| --- | --- | --- |
| Needs | nothing from the school | a developer key from the school's Canvas admin |
| Student does | pastes their private Calendar Feed link once | signs in to Canvas |
| Gets | assignments with due dates (title, course code, due time, link) | + course names, instructors, submission status |

### Calendar feed

Canvas gives every student a private iCalendar link (Canvas > Calendar >
Calendar Feed). `canvas/feed.ts` reads it, following the format in Canvas's own
calendar-feed code: `UID:event-assignment-<id>` (the API's assignment id),
`SUMMARY:<title> [<course code>]`, `DTSTART` in UTC (or a date for all-day
items), and a calendar `URL` with `include_contexts=course_<course id>`.
Undated items aren't in the feed. Calendar events (lectures etc.) are skipped.

- The link is a secret: `connectCanvasFeedAction` checks it's a Canvas feed on an
  allowed host over HTTPS, downloads it once to confirm it works, and stores it
  encrypted (`feed_url_encrypted`, bound to the student). It's never shown again.
- Downloads: server-side only, no redirects, 15 s timeout, 5 MB limit.
- A dead link (404/401/403) marks the connection "needs attention" and asks for a new link.
- Feeds can leave out older items, so only tasks due from today on are ever
  reported as "no longer in Canvas".
- Courses start with the course code as their name (the feed has nothing more);
  students can rename them, and a later OAuth sync fills in the real names.

### Sign-in flow (OAuth)

1. Settings > Integrations > Canvas: the student enters their school's Canvas
   address and clicks **Connect Canvas** (`connectCanvasAction`, a server action).
   The address is validated (`parseCanvasBaseUrl`: HTTPS, an allowed host, no IPs,
   ports or credentials). A random `state` is stored in an encrypted, HttpOnly,
   SameSite=Lax cookie (10 minutes, callback path only), and the student is sent
   to `{canvas}/login/oauth2/auth`.
2. The student signs in to Canvas and approves Student OS (read-only scopes).
3. Canvas redirects to `GET /api/integrations/canvas/callback` with `code` and
   `state`. The route checks the student is signed in, the state matches the
   cookie (constant-time, same student, not expired), deletes the cookie, exchanges
   the code for tokens server-side (`POST /login/oauth2/token`), and saves the
   connection with tokens encrypted. It redirects to `/settings?canvas=<outcome>`
   (a short code, never a token or an error text).
4. **Import Canvas data / Sync now** (`syncLmsAction`) runs `syncLms` with the
   Canvas adapter: courses (`GET /api/v1/courses?enrollment_type=student&enrollment_state=active`)
   then each course's assignments (`GET /api/v1/courses/:id/assignments?include[]=submission`),
   following pagination. The summary is shown in Settings; imported tasks appear
   everywhere at once.
5. **Disconnect** (`disconnectLmsAction`) revokes the token at Canvas (best
   effort, `DELETE /login/oauth2/token`) and deletes the connection. Imported
   courses and tasks stay.

Canvas access tokens last about an hour. `token-service.ts` refreshes them before
they expire (and once after a 401), stores the new token encrypted, and marks the
connection `needs_reauth` if Canvas rejects the refresh token; Settings then
offers **Reconnect**.

Student OS only reads from Canvas: it never submits, grades, comments or edits.

### Canvas setup (developer key)

A Canvas developer key can only be created by a Canvas admin, and only works in
that school's Canvas. Student OS never creates one itself.

1. In Canvas as an admin: **Admin > (account) > Developer Keys > + Developer Key > + API Key**.
2. Key name: "Student OS". Redirect URIs: your callback, e.g.
   `http://localhost:3000/api/integrations/canvas/callback` for local development
   and `https://<your domain>/api/integrations/canvas/callback` in production.
3. Recommended: turn on **Enforce Scopes** and allow only
   `url:GET|/api/v1/courses` and `url:GET|/api/v1/courses/:course_id/assignments`
   (read-only). Without enforced scopes, set `CANVAS_REQUEST_SCOPES=false`.
4. Save, then turn the key **On**. The key's ID is `CANVAS_CLIENT_ID`; "Show Key"
   gives `CANVAS_CLIENT_SECRET`.

### Local testing

1. `.env.local` (never committed):
   ```
   LMS_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32>
   CANVAS_CLIENT_ID=<developer key ID>
   CANVAS_CLIENT_SECRET=<developer key secret>
   CANVAS_REDIRECT_URI=http://localhost:3000/api/integrations/canvas/callback
   # only for a self-hosted Canvas: CANVAS_ALLOWED_HOSTS=canvas.myschool.edu
   ```
2. `npm run db:migrate` (once), then `npm run dev`.
3. Sign in, open **Settings > Integrations**, enter your Canvas address
   (e.g. `myschool.instructure.com`) and click **Connect Canvas**. Approve in Canvas.
4. Back in Settings ("Canvas connected"), click **Import Canvas data**.
5. Check **Courses** (your Canvas courses), **Tasks** (assignments, marked "From
   Canvas" with **Open in Canvas**), and **Planner** (they're planned like any task).
6. Change a due date in Canvas (if you can) or in Student OS and **Sync now** to
   see updates and conflicts in the summary.

Without a developer key, `npm test` covers the whole flow against a fake Canvas
(`canvas/canvas.test.ts`, `src/app/actions/integrations.test.ts`).

### Known limitations

- One developer key works for one school's Canvas. Supporting many schools needs a
  key per school (or an Instructure-approved global key) and a way to pick it.
- Course matching is by Canvas id, then exact course code (normalized). Canvas codes
  often include a section ("CSC215-01"), so an existing "CSC215" course won't be
  linked automatically; a separate course is created instead (safer than a wrong merge).
- Assignments without a due date aren't imported (every task needs one); the summary counts them.
- Estimates aren't provided by Canvas: new tasks get the same default estimate a
  syllabus import uses, which the student can change.
- Removed assignments are reported and kept, not deleted; there's no "archive" state yet.
- Sync runs when the student clicks it (no background sync yet).
- Rate-limited or failed requests aren't retried automatically; the student tries again.
- The OAuth state cookie and tokens depend on `LMS_TOKEN_ENCRYPTION_KEY`; rotating
  it needs a re-encryption step (the `v1:` prefix allows a `v2` key).

## Before Blackboard works

Implement `blackboard/` like `canvas/` (Blackboard Learn three-legged OAuth and
REST API), add its callback route and connect action, and remove "coming soon".
