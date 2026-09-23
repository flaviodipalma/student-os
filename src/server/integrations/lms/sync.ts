import "server-only"

import { and, eq } from "drizzle-orm"
import {
  planCourses,
  planTasks,
  type ExistingCourse,
  type ExistingTask,
  type SyncedCourseFields,
  type SyncedTaskFields,
} from "@/lib/lms/sync-plan"
import type { LmsAssignment, LmsCourse, LmsSyncResult } from "@/lib/lms/types"
import type { ExternalSource, LmsProviderId } from "@/lib/types"
import { toCourse, toTask } from "../../db/mappers"
import { courses, tasks } from "../../db/schema"
import type { Database } from "../../db/types"
import { AppError, toAppError } from "../../errors"
import { createCourse, updateCourse } from "../../services/courses"
import { createTask, updateTask } from "../../services/tasks"
import { recordLmsSync } from "./connections"
import type { CredentialVault } from "./credential-vault"
import { LmsError, type LmsProvider } from "./provider"
import { createLmsAccess } from "./token-service"

// Syncs one student's LMS into their normal Student OS courses and tasks:
//
//   1. the student: always the signed-in user's id (from the session)
//   2. their connection for this provider (credentials decrypted on the server)
//   3. fetch normalized courses from the provider adapter
//   4-5. match them to existing courses and create / update / link (sync-plan.ts)
//   6. fetch normalized assignments for each course
//   7-8. match them to existing tasks and create / update / link, keeping the
//        student's own changes (three-way merge, conflicts reported)
//   9. record when it synced (or a safe error)
//   10. return a summary (LmsSyncResult)
//
// Fetching happens first; all saving happens in one transaction, so a failure
// part-way leaves Student OS as it was. Writes go through the normal course and
// task services, so the same ownership checks and validation apply.
// Imported records are ordinary courses and tasks: the Planner, Dashboard and
// Tasks page need nothing LMS-specific.

// Where a sync reads from: normalized courses and assignments, from any source
// (OAuth + API, or a calendar feed). The sync itself is the same for all.
export type LmsReader = {
  provider: LmsProviderId
  name: string
  getCourses(): Promise<LmsCourse[]>
  getAssignments(courseExternalId: string): Promise<LmsAssignment[]>
  // Only tasks due on/after this date can be reported "missing" (see planTasks).
  missingFrom?: string
}

type SyncOptions = { now?: Date; timeZone?: string }

// Sync through an OAuth connection (tokens via the token service).
export async function syncLms(
  db: Database,
  userId: string,
  provider: LmsProvider,
  vault: CredentialVault,
  options: SyncOptions = {}
): Promise<LmsSyncResult> {
  const now = options.now ?? new Date()
  return runSync(db, userId, { provider: provider.id, name: provider.name }, options, async () => {
    const access = await createLmsAccess(db, userId, provider, vault, { timeZone: options.timeZone, now: () => now })
    return {
      provider: provider.id,
      name: provider.name,
      getCourses: () => provider.getCourses(access),
      getAssignments: (courseId) => provider.getAssignments(access, courseId),
    }
  })
}

// The shared sync. `open` sets up the reader (inside the error handling, so a
// failure there is recorded on the connection too).
export async function runSync(
  db: Database,
  userId: string,
  source: { provider: LmsProviderId; name: string },
  options: SyncOptions,
  open: () => Promise<LmsReader>
): Promise<LmsSyncResult> {
  const now = options.now ?? new Date()
  const provider = { id: source.provider, name: source.name }
  const result: LmsSyncResult = {
    provider: provider.id,
    coursesCreated: 0,
    coursesUpdated: 0,
    coursesLinked: 0,
    assignmentsCreated: 0,
    assignmentsUpdated: 0,
    assignmentsLinked: 0,
    assignmentsSkipped: 0,
    assignmentsWithoutDueDate: 0,
    assignmentsMissing: 0,
    missing: [],
    conflicts: [],
    errors: [],
    syncedAt: now.toISOString(),
  }

  try {
    // 2-3, 6. Read from the LMS (outside the transaction: these are network calls).
    const reader = await open()
    const lmsCourses = (await reader.getCourses()).filter((c) => c.provider === provider.id)
    const assignments: LmsAssignment[] = []
    // Courses whose assignments were read; only these can have "missing" tasks.
    const readCourses = new Set<string>()
    for (const course of lmsCourses) {
      try {
        assignments.push(
          ...(await reader.getAssignments(course.externalId)).filter(
            (a) => a.provider === provider.id && a.courseExternalId === course.externalId
          )
        )
        readCourses.add(course.externalId)
      } catch (error) {
        // One course that can't be read doesn't stop the rest.
        if (!(error instanceof LmsError) || error.scope !== "course") throw error
        result.errors.push(`${course.courseName}: ${error.message}`)
      }
    }

    await db.transaction(async (tx) => {
      // 4-5. Courses.
      const courseIdByExternal = new Map<string, string>()
      for (const action of planCourses(await existingCourses(tx, userId), lmsCourses)) {
        const source = sourceOf(provider.id, action.lms.externalId, action.lms.url)
        if (action.kind === "create") {
          try {
            const created = await createCourse(tx, userId, action.fields)
            await setCourseSource(tx, userId, created.id, source, action.fields, now)
            courseIdByExternal.set(action.lms.externalId, created.id)
            result.coursesCreated++
          } catch (error) {
            // e.g. two LMS courses with the same code: skip it, keep going.
            result.errors.push(`${action.fields.code}: ${toAppError(error).message}`)
          }
          continue
        }
        if (action.kind === "update") {
          await updateCourse(tx, userId, action.courseId, action.changes)
          result.coursesUpdated++
        } else if (action.kind === "link") {
          result.coursesLinked++
        }
        await setCourseSource(tx, userId, action.courseId, source, action.synced, now)
        courseIdByExternal.set(action.lms.externalId, action.courseId)
      }

      // 7-8. Assignments -> tasks.
      const existing = await existingTasks(tx, userId)
      const plan = planTasks(existing, assignments, (id) => courseIdByExternal.get(id), {
        provider: provider.id,
        courseIds: [...courseIdByExternal.entries()].filter(([external]) => readCourses.has(external)).map(([, id]) => id),
        missingFrom: reader.missingFrom,
      })
      for (const action of plan.actions) {
        if (action.kind === "skip") {
          result.assignmentsSkipped++
          if (action.reason === "no-due-date") result.assignmentsWithoutDueDate++
          continue
        }
        const source = sourceOf(provider.id, action.lms.externalId, action.lms.url)
        if (action.kind === "create") {
          const created = await createTask(tx, userId, action.input)
          await setTaskSource(tx, userId, created.id, source, action.synced, now)
          result.assignmentsCreated++
          continue
        }
        if (action.kind === "update") {
          await updateTask(tx, userId, action.taskId, action.changes)
          result.assignmentsUpdated++
        } else if (action.kind === "link") {
          result.assignmentsLinked++
        } else {
          result.assignmentsSkipped++
        }
        // The LMS's current values become the baseline for the next sync.
        await setTaskSource(tx, userId, action.taskId, source, action.synced, now)
      }
      result.conflicts = plan.conflicts
      result.assignmentsMissing = plan.missingTaskIds.length
      result.missing = existing
        .filter((task) => plan.missingTaskIds.includes(task.id))
        .map((task) => ({ taskId: task.id, title: task.title }))
    })

    // 9.
    await recordLmsSync(db, userId, provider.id, { syncedAt: now })
    return result
  } catch (error) {
    // Only a safe message is kept or returned; provider errors can contain tokens or URLs.
    const safe = error instanceof AppError ? error.message : `Syncing with ${provider.name} failed. Please try again.`
    const reconnect = error instanceof LmsError && error.reconnect
    await recordLmsSync(db, userId, provider.id, { error: safe, reconnect }).catch(() => {})
    throw error instanceof AppError ? error : new AppError("database", safe)
  }
}

// ---- Helpers ------------------------------------------------------------------------

const sourceOf = (provider: LmsProviderId, externalId: string, url: string | null): ExternalSource => ({
  provider,
  externalId,
  url: url ?? undefined,
})

async function existingCourses(db: Database, userId: string): Promise<ExistingCourse[]> {
  const rows = await db.select().from(courses).where(eq(courses.userId, userId))
  return rows.map((row) => ({ ...toCourse(row), synced: (row.externalSynced as Partial<SyncedCourseFields>) ?? null }))
}

async function existingTasks(db: Database, userId: string): Promise<ExistingTask[]> {
  const rows = await db.select().from(tasks).where(eq(tasks.userId, userId))
  return rows.map((row) => ({ ...toTask(row), synced: (row.externalSynced as Partial<SyncedTaskFields>) ?? null }))
}

async function setCourseSource(
  db: Database,
  userId: string,
  courseId: string,
  source: ExternalSource,
  synced: SyncedCourseFields,
  now: Date
) {
  await db
    .update(courses)
    .set({
      externalSource: source.provider,
      externalId: source.externalId,
      externalUrl: source.url ?? null,
      externalSynced: synced,
      externalSyncedAt: now,
    })
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
}

async function setTaskSource(
  db: Database,
  userId: string,
  taskId: string,
  source: ExternalSource,
  synced: SyncedTaskFields,
  now: Date
) {
  await db
    .update(tasks)
    .set({
      externalSource: source.provider,
      externalId: source.externalId,
      externalUrl: source.url ?? null,
      externalSynced: synced,
      externalSyncedAt: now,
    })
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
}
