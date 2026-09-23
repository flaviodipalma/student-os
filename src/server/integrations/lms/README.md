# LMS integrations (Canvas, Blackboard)

**Status: architecture only.** No LMS is connected. The Canvas and Blackboard
adapters make no network calls; every method throws `LmsNotAvailableError`.
Settings shows both as "coming soon".

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
| `canvas/`, `blackboard/` | Adapters (not implemented yet) |
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
- Tokens are decrypted only in `loadLmsCredentials`, on the server, for a sync.
  They're never returned from a server action, rendered, put in URLs or logged.
  `LmsConnectionSummary` (what the UI gets) has no tokens or LMS ids.
- Every query filters by the signed-in student's id (from the session). External
  ids are only looked up within that student's rows, so they can't reach
  another student's records. Writes go through the normal course/task services.
- Sync errors store and return only safe messages; provider errors (which can
  contain URLs or tokens) aren't passed on.
- Provider secrets are server-only env vars (no `NEXT_PUBLIC_`), names only in `.env.example`.
- The `lms_connections` table has Row Level Security on with no policies, like every table.

## Before real connections work

1. Register OAuth apps (Canvas developer key per institution; Blackboard REST app) and set the env vars, plus `LMS_TOKEN_ENCRYPTION_KEY`.
2. OAuth routes: `/api/integrations/[provider]/start` (create a random single-use
   `state`, store it server-side or in an HttpOnly, SameSite cookie, redirect) and
   `/callback` (verify `state`, exchange the code server-side, `saveLmsConnection`).
3. Implement each adapter: authorization URL, code exchange, token refresh,
   revoke, course/assignment reads with pagination and rate limits, and mapping
   to the normalized types (including converting due timestamps to the student's time zone).
4. Refresh expired tokens before a sync; mark `needs_reauth` when refresh fails.
5. Server actions for "Sync now" and "Disconnect", and a UI for the sync summary
   (created / updated / conflicts / missing), including resolving conflicts and missing tasks.
6. Key management: secret storage in hosting, and a rotation plan (the `v1:` prefix allows a `v2` key).
7. Decide on institution selection (Canvas/Blackboard addresses are per school).
