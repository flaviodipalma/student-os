# LMS integrations (Canvas, Blackboard)

**Status:** Canvas is implemented, read-only, three ways: the Student OS browser
extension (no school approval needed; see "Browser extension" below), the
student's private calendar feed (no school approval needed), or OAuth 2.0 + the
REST API (needs a developer key from the school).
Blackboard Learn is implemented, read-only, two ways: the student's private
calendar link ("Share Calendar", no school approval needed) or three-legged OAuth
2.0 + the Learn REST API (needs an app registered on the Anthology Developer Portal
**and approved by the student's school**). Canvas and Blackboard can be connected
at the same time.

**What students use today: the browser extension for Canvas, and the calendar
feeds.** OAuth API access needs each university to approve Student OS, which hasn't
happened yet. The extension gets the same data as OAuth (course names, instructors,
submission status) by reading Canvas with the student's own login in their browser.
A calendar connection is NOT full Canvas/Blackboard API access: it brings in
assignment due dates (as tasks) and calendar events (as read-only events on the
Calendar), nothing more. Calendar events are described in
`src/lib/calendar/README.md`.

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
| `blackboard/` | Blackboard Learn adapter: `config.ts`, `oauth.ts` (3LO + PKCE), `api-client.ts` (paging, errors), `mapping.ts`, `blackboard-provider.ts`; calendar link: `feed.ts`, `feed-sync.ts` |
| `ical.ts`, `feed-fetch.ts` | Shared: iCalendar reader and the safe feed downloader (Canvas and Blackboard feeds) |
| `base-url.ts`, `normalize.ts` | Shared: LMS address allowlist check, same-origin links, HTML -> text, UTC -> local due dates |
| `oauth-callback.ts` | The OAuth callback for every provider (`/api/integrations/<provider>/callback`) |
| `token-service.ts` | The only code that decrypts, refreshes and re-stores tokens (`LmsAccess`) |
| `oauth-state.ts` | Single-use OAuth `state` + PKCE verifier in an encrypted HttpOnly cookie (CSRF protection) |
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
| title, description, due date, due time, link, submission status (course: code, name, professor, description, link) | **LMS-controlled**: synced from the LMS (with the three-way rule below) |
| type | set once when created |
| estimate | set once, only if the LMS states one; otherwise **null** (never guessed; the Planner uses its fallback and asks the student to add one) |
| priority, estimate, notes, planned date, study sessions | **student-controlled**: never changed by a sync (priority starts at the Student OS default, medium) |
| status | the student's, with one conservative exception (below) |

**Submission status → task status (conservative):**
- An assignment already *submitted* or *graded* when first imported becomes a
  completed task (nothing left to plan).
- An existing task is marked completed only when a sync sees the LMS change from
  not submitted to submitted/graded, and the student hasn't completed it.
- The LMS never un-completes a task; if the student reopens it, it stays open.
- "Unknown" (e.g. the calendar feed, which has no submission data) changes nothing.
The status is shown on imported tasks ("Submitted in Canvas" / "Graded in Canvas").

**Notes vs description:** an imported task's description comes from the LMS;
the student's own notes go in `tasks.notes` ("Your notes"), which no sync touches.

**Conflicts (three-way):** base = `external_synced`, local = the task now,
remote = the LMS now. LMS-only changes are applied; student-only changes are
kept; if both changed a field, the student's value is kept, the conflict is
reported in `LmsSyncResult.conflicts`, and the base moves to the LMS value (so
it isn't re-reported until the LMS changes it again).

**Deleted in the LMS:** never deleted in Student OS automatically. Such tasks
are counted in `assignmentsMissing` for the student to review.

**No due date:** not imported (every task needs one); counted as skipped.

**Courses the LMS stops listing** (term ended, dropped, deleted): reported in
`missingCourses`, kept with their tasks. Only an OAuth sync can tell (it lists
every current course); the calendar feed only contains courses with items, and the
extension sends only the courses the student chose.

**Reliability:**
- Everything the LMS returns is read first; then all saving happens in one
  transaction, with each course and assignment in its own savepoint. One item
  that can't be saved is rolled back alone and reported in `errors`; the rest
  still syncs. A course that can't be *read* is skipped (`coursesSkipped`) and its
  tasks are not reported as missing.
- One sync at a time per student and LMS (a Postgres advisory lock); a second
  "Sync now" (another tab) gets "A sync is already running". The button is also
  disabled while syncing.
- Duplicates are impossible: unique `(user_id, external_source, external_id)`
  on courses and tasks, and matching by those ids first.

**Summary** (`LmsSyncResult`, shown on the Integrations page): courses added / linked / updated /
skipped, assignments added / linked / updated / skipped / without a due date,
tasks marked done from the LMS, conflicts (student's value kept), assignments and
courses no longer in the LMS, safe error messages, and the sync time.

## Security review

- Connections use the student's private calendar feed link, OAuth 2.0, or the
  browser extension. No LMS passwords or personal access tokens are asked for or
  stored; no scraping. Feed links are treated like tokens (encrypted, never shown).
  An extension connection stores no LMS secret at all (the student's Canvas login
  never leaves their browser).
- Tokens are encrypted (AES-256-GCM, key `LMS_TOKEN_ENCRYPTION_KEY`) and bound to
  `<user id>:<provider>`, so a copied ciphertext won't decrypt for another student.
  Without the key, tokens can't be stored at all (no plain-text fallback).
- Tokens are decrypted only on the server: by the token service during a sync, and
  by disconnect (to revoke). They're sent to the LMS only in the Authorization
  header, and never returned from a server action, rendered, put in URLs or logged
  (only error *types* are logged).
- The OAuth `state` is random, single-use, bound to the signed-in student, checked
  in constant time and expires after 10 minutes. It carries a PKCE code verifier
  (RFC 7636, S256), which Blackboard checks when the code is exchanged. The redirect
  URI and client secret come from server config, never the request.
- The student-entered Canvas / Blackboard address is validated against an allowlist
  (`CANVAS_ALLOWED_HOSTS`, `BLACKBOARD_ALLOWED_HOSTS`) before the client secret is
  ever sent to it (HTTPS only; no IPs, ports or credentials). Pagination links and
  "Open in Canvas / Blackboard" links are only followed/kept on that same host,
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

Three ways to connect, one sync. All read the same Canvas course and
assignment ids, so a student can switch between them without duplicates (saving
one replaces the other on the connection; switching from the feed to the extension
hides the feed's calendar events, which would no longer update).

| | Browser extension | Calendar feed | Sign in with Canvas (OAuth) |
| --- | --- | --- | --- |
| Needs | nothing from the school | nothing from the school | a developer key from the school's Canvas admin |
| Student does | installs the extension, clicks Sync now on Canvas, chooses courses | pastes their private Calendar Feed link once | signs in to Canvas |
| Gets | course names, instructors, assignments, submission status (chosen courses) | assignments with due dates (title, course code, due time, link) | course names, instructors, assignments, submission status (all active courses) |
| Syncs | when the student clicks Sync now in the extension | Sync now on the Integrations page | Sync now on the Integrations page |

### Browser extension

The Student OS Chrome extension (`extension/`, see `extension/README.md`) reads
Canvas's own API **inside the student's Canvas tab**, with their Canvas login, then
sends the data to Student OS, logged in as that student in the same browser. No
pairing, no secrets stored.

1. The student opens Canvas, clicks the extension, then **Sync now**. It reads the
   active courses with their term (`GET /api/v1/courses?enrollment_type=student&
   enrollment_state=active&include[]=teachers&include[]=term`) and shows them by
   semester; current-semester courses start checked. The choice is remembered in
   the extension; a course it hasn't seen before brings the list back.
2. It reads the chosen courses' assignments (`GET /api/v1/courses/:id/assignments?
   include[]=submission&order_by=due_at`), following pagination on the same host,
   a few courses at a time. Only the fields Student OS uses are kept (no grades,
   scores or points).
3. `POST /api/extension/canvas/import` (`src/app/api/extension/canvas/import`):
   the student from the Student OS session; the extension check in
   `src/server/integrations/extension/http.ts` (required header, extension Origin,
   optional `STUDENT_OS_EXTENSION_IDS`); size limits (2 MB, 100 courses, 500
   assignments per course) and the Sync now rate limit (shared route:
   `extension/import-route.ts`); the Canvas address must be a public HTTPS address
   (`extension/base-url.ts`: any school domain, since the server never contacts it
   here; no IPs, ports or local names); every course and assignment through the same
   validators (`canvas/mapping.ts`); then `runSync`
   (`src/server/integrations/extension/canvas-import.ts`). The connection is saved
   with method `extension`.

Automatic sync (optional, a switch in the extension): with access to the student's
Canvas address, the extension's background worker syncs the chosen courses when a
Canvas tab loads, at most once every 30 minutes, through the same endpoint and
checks. It never adds courses on its own; a new one is flagged for the student.

A course the student unchecks stops syncing; its tasks stay (never reported as
missing). The Integrations page shows "Through the browser extension" with no Sync
now button (only the extension can read Canvas for this connection); Disconnect
deletes the connection until the next Sync now in the extension.

### Calendar feed

Canvas gives every student a private iCalendar link (Canvas > Calendar >
Calendar Feed). `canvas/feed.ts` reads it, following the format in Canvas's own
calendar-feed code: `UID:event-assignment-<id>` (the API's assignment id),
`SUMMARY:<title> [<course code>]`, `DTSTART` in UTC (or a date for all-day
items), and a calendar `URL` with `include_contexts=course_<course id>`.
Undated items aren't in the feed. Calendar events (`UID:event-calendar-event-<id>`:
exams, class meetings, office hours added to the Canvas calendar) become read-only
calendar events, not tasks (`canvasFeedCalendarEvents`; see `src/lib/calendar/README.md`).

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

1. Integrations > Canvas: the student enters their school's Canvas
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
   connection with tokens encrypted. It redirects to `/integrations?canvas=<outcome>`
   (a short code, never a token or an error text).
4. **Import Canvas data / Sync now** (`syncLmsAction`) runs `syncLms` with the
   Canvas adapter: courses (`GET /api/v1/courses?enrollment_type=student&enrollment_state=active`)
   then each course's assignments (`GET /api/v1/courses/:id/assignments?include[]=submission`),
   following pagination. The summary is shown on the Integrations page; imported tasks appear
   everywhere at once.
5. **Disconnect** (`disconnectLmsAction`) revokes the token at Canvas (best
   effort, `DELETE /login/oauth2/token`) and deletes the connection. Imported
   courses and tasks stay.

Canvas access tokens last about an hour. `token-service.ts` refreshes them before
they expire (and once after a 401), stores the new token encrypted, and marks the
connection `needs_reauth` if Canvas rejects the refresh token; Integrations then
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
3. Sign in, open **Integrations** (in the sidebar), enter your Canvas address
   (e.g. `myschool.instructure.com`) and click **Connect Canvas**. Approve in Canvas.
4. Back on Integrations ("Canvas connected"), click **Import Canvas data**.
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
- Canvas gives no time estimates: imported tasks have none until the student adds
  one (the Planner still plans them with its fallback length and a reminder).
- Removed assignments are reported and kept, not deleted; there's no "archive" state yet.
- Sync runs when the student clicks it (no background sync yet).
- Assignment overrides (different due dates per section) follow what Canvas returns
  for the signed-in student; calendar-feed items with an override id are imported
  as separate items.
- Rate-limited or failed requests aren't retried automatically; the student tries again.
- The OAuth state cookie and tokens depend on `LMS_TOKEN_ENCRYPTION_KEY`; rotating
  it needs a re-encryption step (the `v1:` prefix allows a `v2` key). If the key is
  lost or replaced, saved connections can't be decrypted: syncing marks them
  "needs attention" and asks the student to connect again (nothing else breaks).

## Blackboard Learn

Same architecture as Canvas: `BlackboardProvider` implements `LmsProvider`; the
connection row, token service, credential vault, OAuth state, sync service,
matching and conflict rules, summary and Integrations UI are all shared. Imported
records use `external_source = 'blackboard'` with Learn's primary ids
(`_215_1`), so they never collide with Canvas records, even with identical ids.

Sources: the Learn REST docs (Getting Started > 3-Legged OAuth, Basic
Authentication, Rate Limits; Hands-on > Gradebook, Calendar APIs) and the Learn
API spec (Developer Portal, v4000.x).

### Sign-in flow (three-legged OAuth)

1. Integrations > Blackboard: the student enters their school's
   Blackboard address and clicks **Connect Blackboard** (`connectBlackboardAction`).
   The address is validated (`parseBlackboardBaseUrl`). A random `state` and PKCE
   verifier go into an encrypted HttpOnly cookie (10 minutes, callback path only),
   and the student is sent to
   `{learn}/learn/api/public/v1/oauth2/authorizationcode?client_id=<app key>&scope=read offline&state&code_challenge&code_challenge_method=S256`.
2. The student signs in on the school's own Blackboard page (Student OS never sees
   the password) and approves.
3. Learn redirects to `GET /api/integrations/blackboard/callback`. The route checks
   the state (same as Canvas), then exchanges the code server-side:
   `POST /learn/api/public/v1/oauth2/token?grant_type=authorization_code&code&redirect_uri&code_verifier`
   with HTTP Basic `key:secret`. The token names the student by UUID; Student OS
   looks up their REST primary id once (`GET v1/users/uuid:<id>?fields=id`) and
   stores it with the encrypted tokens. Outcome codes: `connected`, `denied`,
   `invalid_state`, `not_approved` (Learn answered 401: the school hasn't approved
   the app), `not_configured`, `error`.
4. **Import Blackboard data / Sync now**: `syncLms` with the Blackboard adapter.
5. **Disconnect** deletes the connection and tokens. Learn's public API has no
   token revocation endpoint, so nothing is sent to Blackboard; the access token
   expires within the hour. (A student or admin can remove the app's access in
   Blackboard.) Imported courses and tasks stay.

Access tokens last about an hour; the `offline` scope gives a refresh token, used by
the token service like Canvas's (`grant_type=refresh_token`). A rejected refresh
token marks the connection `needs_reauth`; a 401 for the app itself (approval
withdrawn) is reported as an error asking the student to contact their admin.

### What is read (all GET, as the student)

| Data | Endpoint | Becomes |
| --- | --- | --- |
| Courses | `v1/users/{id}/courses?expand=course` (paged) | `LmsCourse` -> course. Only course role **Student**, membership and course available ("Yes" or "Term"); organizations and courses the student teaches/assists are skipped. Link: the course's `externalAccessUrl` (same host only). |
| Assignments | `v2/courses/{id}/gradebook/columns` (paged) | `LmsAssignment` -> task. Visible, non-calculated, non-total columns; title `displayName` (Classic) or `name` (Ultra); due `grading.due` in the student's time zone; type from `scoreProviderHandle` (tests -> quiz, discussions/blogs/journals -> other, else assignment); link: the course page (the API has no per-item student link). |
| Grades | `v2/courses/{id}/gradebook/users/{id}` (1 call per course) | `graded` when a score or text grade exists. Learn's grade `status` field is documented as unreliable and isn't used. |
| Attempts | `v2/courses/{id}/gradebook/columns/{id}/attempts?userId={id}` | `submitted` if an attempt is NeedsGrading / NeedsGradingAgain / Completed / InProgressAgain, `not_submitted` if none are. Only for ungraded, attempt-based items due in the last 30 days or later, at most 25 per course (Blackboard's default limit is 10,000 calls per day per developer group). |

Anything else is `unknown`: never counted as done. Status rules are Canvas's: done on
import only if graded/submitted; later only on an observed change to
graded/submitted while the task isn't done; never un-completed.

**Calendar API:** not used (unsupported, not faked). For students,
`GET v1/calendars/items` returns gradebook items (already imported above),
institution and personal events, only in windows of at most 16 weeks, and personal
items are the student's own Blackboard entries. Class meeting times aren't exposed.

### Browser extension

The same as Canvas's (see Canvas > Browser extension), reading Learn's REST API
inside the student's Blackboard tab with their own login (Blackboard's Ultra pages
use the same API): `v1/users/me`, `v1/users/{id}/courses?expand=course`, `v1/terms`
(for the course list by semester; optional), then for the chosen courses
`v1/courses/{id}/users?role=Instructor&expand=user` (instructors' names only, the
course's professor; optional, and unlike the OAuth adapter, which leaves it empty),
`v2/courses/{id}/gradebook/columns`, `v2/courses/{id}/gradebook/users/{id}` and, for
recent attempt-graded columns (at most 25 per course), their `attempts`.
`POST /api/extension/blackboard/import`
(`src/server/integrations/extension/blackboard-import.ts`) reuses this adapter's
mapping (`blackboard/mapping.ts`): courses taken as a student, real work columns, a
real grade or a turned-in attempt means done, "unknown" otherwise.

Switching from the calendar link links the tasks it imported (the feed's gradable
items use the same column ids), so nothing is duplicated, and hides the link's
calendar events. Known limitation: those tasks stay in the link's "Blackboard"
course, because a sync never moves a linked task to another course.

### Calendar link (no school approval)

Blackboard Ultra: **Calendar > Calendar Settings > ⋯ > Share Calendar** gives every
student a private iCalendar link
(`https://<school>/webapps/calendar/calendarFeed/<token>/learn.ics`). Integrations offers
it first ("Your Blackboard calendar link"); `connectBlackboardFeedAction` checks it
(`parseBlackboardFeedUrl`: an allowed Blackboard host, that exact path shape, HTTPS),
downloads it once, and stores it encrypted (`saveLmsFeedConnection`). Syncs go
through `syncBlackboardFeed` -> the shared `runSync`.

What the feed contains (checked against a real Learn feed, September 2026; Blackboard
doesn't document it):

- One event per gradable item, `UID:_blackboard.platform.gradebook2.GradableItem-<column id>`.
  The column id (`_1598993_1`) is the REST API's gradebook column id, so signing in
  later reuses the same tasks (tested).
- `SUMMARY` = title, `DTSTART;TZID=<zone>` = due time, empty `DESCRIPTION`, no URL.
- **No course information at all.** Items go into one course, "Blackboard" (code
  `BLACKBOARD`), which the student can rename, or move tasks out of; syncs never
  move tasks back.
- Items from a year back to a year ahead. **Only items due today or later are
  imported**: the feed has no submission status, and importing a year of past work
  as to-do would flood the Planner. Only those can be reported "no longer in Blackboard".
- No submission status (always unknown), no estimates, no link.
- Other entries (course calendar events, office hours: not gradable items) become
  read-only calendar events, identified by their full UID
  (`blackboardFeedCalendarEvents`; see `src/lib/calendar/README.md`). The sample
  feed had none, so their exact shape isn't confirmed yet.

### Blackboard setup (institution admin required)

1. A developer registers the app at the **Anthology Developer Portal**
   (developer.anthology.com, formerly developer.blackboard.com) and gets an
   **Application ID**, **Key** and **Secret**. Register the redirect URI(s):
   `https://<your domain>/api/integrations/blackboard/callback` (and
   `http://localhost:3000/...` for development, if the portal allows it).
2. **The school's Blackboard administrator must add and approve the app** on their
   Learn server: *System Admin > Integrations > REST API Integrations > Create
   Integration*, enter the Application ID, choose a user for the integration, and
   allow **End User Access** (required for three-legged OAuth). Until this is done,
   Blackboard answers the token request with 401 and Integrations says "Your school
   hasn't enabled Student OS in Blackboard yet."
3. Schools with a custom login page must use Learn's `<loginUI:loginForm/>` tag,
   or students get stuck on the Learn landing page after signing in (Blackboard doc
   "REST Integrations 3-Legged OAuth and Learn Custom Login Pages").
4. Server env (`.env.local`, never committed):
   ```
   BLACKBOARD_CLIENT_ID=<application KEY (not the Application ID)>
   BLACKBOARD_CLIENT_SECRET=<application secret>
   BLACKBOARD_REDIRECT_URI=http://localhost:3000/api/integrations/blackboard/callback
   # schools on their own domain: BLACKBOARD_ALLOWED_HOSTS=*.blackboard.com,learn.myschool.edu
   ```
5. In Student OS: Integrations > Blackboard, enter the school's
   address, **Connect Blackboard**, sign in, then **Import Blackboard data**.

Without a registered app and an approving school, `npm test` covers the flow
against a fake Learn server (`blackboard/blackboard.test.ts`,
`src/app/actions/integrations.test.ts`; fixtures in `src/server/test-utils/fake-blackboard.ts`).

### Known limitations

- Sign-in: one app registration works for every school, but **each school's admin
  must approve it**. Without that, the calendar link works, with less detail (no
  course names, no submission status, upcoming items only).
- The calendar link's path shape comes from a real feed and public school guides;
  if a school's link looks different, connecting fails with a clear message.
- Instructors aren't imported (a separate per-course request students often can't make).
- "Open in Blackboard" opens the course, not the individual item.
- Items without a due date aren't imported; manual-grade items without a grade stay
  "unknown"; attempt status is only checked for recent/upcoming items.
- Courses with the same code in Canvas and Blackboard: the second one is skipped and
  reported (course codes are unique per student), never merged across LMSs.
- The live flow hasn't been tested against a real Learn server from this project
  (no registered app yet): it's built to the official docs and API spec.
