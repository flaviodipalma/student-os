# LMS integrations (Canvas, Blackboard)

**The Student OS browser extension is the only way to connect Canvas and
Blackboard Learn** (`extension/`, see `extension/README.md`). It reads the LMS's own
API inside the student's tab, with their own LMS login, and sends the data to
Student OS, logged in as that student in the same browser. No school approval, no
app keys, and no LMS secret stored anywhere: the server never contacts Canvas or
Blackboard. Read-only. Canvas and Blackboard can be connected at the same time.

The earlier calendar-feed links and school-approved sign-in (OAuth) were removed
(migration `0017_extension_only_lms` deleted any such connections and hid their
calendar events; imported courses and tasks stayed). They're in git history.

## Layers

```
extension (Canvas tab)      readCanvas     ──> POST /api/extension/canvas/import      ──┐
extension (Blackboard tab)  readBlackboard ──> POST /api/extension/blackboard/import  ──┤
                                                                                         ├─> runSync (sync.ts) ──> normal Student OS courses & tasks
            validated + mapped: canvas/mapping.ts, blackboard/mapping.ts ──> normalized  │    planCourses / planTasks (src/lib/lms/sync-plan.ts)
            data (src/lib/lms/types.ts)                                                  ┘
```

| File | Job |
| --- | --- |
| `src/lib/lms/types.ts` | Normalized `LmsCourse`, `LmsAssignment`, `LmsSyncResult` (shared, no secrets) |
| `src/lib/lms/sync-plan.ts` | Pure matching, mapping and the three-way conflict rule |
| `canvas/mapping.ts`, `blackboard/mapping.ts` | Each LMS's API objects -> normalized data, every field checked |
| `base-url.ts`, `normalize.ts` | Shared: the LMS address check, same-origin links, HTML -> text, UTC -> local due dates |
| `connections.ts` | A student's connections: record (from an import), status, disconnect. No secrets |
| `sync.ts` | The sync service: read -> plan -> save in one transaction -> summary |
| `provider.ts` | `LmsError`: safe, student-facing messages |
| `src/server/integrations/extension/` | The extension's endpoints: login + extension check (`http.ts`), the shared import route (`import-route.ts`), the LMS address rule (`base-url.ts`), `canvas-import.ts`, `blackboard-import.ts` |

`credential-vault.ts` and `oauth-state.ts` live here for historical reasons; only the
personal calendars (Google Calendar, Outlook: `src/server/integrations/calendar`)
use them now. Everything under `src/server` is `server-only`. The Planner,
Dashboard, Tasks and Courses only ever see normal courses and tasks.

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
- "Unknown" (Blackboard didn't say, e.g. grades hidden) changes nothing.
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

**Courses the LMS stops listing** (term ended, dropped, deleted): kept with their
tasks. The extension sends only the courses the student chose, so a course that
isn't sent may just be unchecked: it's never reported as gone (`missingCourses`
stays empty for extension imports).

**Reliability:**
- Everything the extension sent is read first; then all saving happens in one
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

- The extension uses the student's own LMS login inside their browser; Student OS
  never asks for, sees or stores an LMS password, token or feed link, and never
  contacts the LMS. A connection row holds only the LMS address and the last sync's
  status.
- The import endpoints require the Student OS login and the extension (header,
  Origin; `src/server/integrations/extension/http.ts`), limit size and rate, and
  treat everything as untrusted: the LMS address must be a public HTTPS address (no
  IPs, ports, credentials or local names), links must stay on it, and every course
  and assignment goes through the mapping's validation.
- Every query filters by the signed-in student's id (from the session). External
  ids are only looked up within that student's rows, so they can't reach another
  student's records. Writes go through the normal course/task services.
- Sync errors store and return only safe messages.
- The `lms_connections` table has Row Level Security on with no policies, like every table.

## Canvas

### How it connects

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

## Blackboard Learn

Imported records use `external_source = 'blackboard'` with Learn's primary ids
(`_215_1`), so they never collide with Canvas records.

### How it connects

The same as Canvas's (see Canvas > Browser extension), reading Learn's REST API
inside the student's Blackboard tab with their own login (Blackboard's Ultra pages
use the same API): `v1/users/me`, `v1/users/{id}/courses?expand=course`, `v1/terms`
(for the course list by semester; optional), then for the chosen courses
`v1/courses/{id}/users?role=Instructor&expand=user` (instructors' names only, the
course's professor; optional),
`v2/courses/{id}/gradebook/columns`, `v2/courses/{id}/gradebook/users/{id}` and, for
recent attempt-graded columns (at most 25 per course), their `attempts`.
`POST /api/extension/blackboard/import`
(`src/server/integrations/extension/blackboard-import.ts`) uses the Blackboard
mapping (`blackboard/mapping.ts`): courses taken as a student, real work columns, a
real grade or a turned-in attempt means done, "unknown" otherwise.

## Known limitations

- Syncing needs Chrome with the extension (desktop), logged in to both Student OS
  and the LMS. Automatic sync runs when the student opens the LMS, at most every
  30 minutes; nothing syncs while they don't.
- Course matching is by LMS id, then exact course code (normalized). Codes often
  include a section ("CSC215-01"), so an existing "CSC215" course won't be linked
  automatically; a separate course is created instead (safer than a wrong merge).
- Assignments without a due date aren't imported (every task needs one); the summary counts them.
- Canvas and Blackboard give no time estimates: imported tasks have none until the
  student adds one (the Planner still plans them with its fallback length).
- Removed assignments are reported and kept, not deleted.
- LMS calendar events (office hours, exam sessions) aren't imported yet; the
  extension could read them (Canvas `calendar_events`, Blackboard calendar API).
- Blackboard's submission status: a real grade or a turned-in attempt (recent
  assignments only: at most 25 per course, due within the last 30 days or later).
