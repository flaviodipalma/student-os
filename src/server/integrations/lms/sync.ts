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
import type { LmsAssignment, LmsSyncResult } from "@/lib/lms/types"
import type { ExternalSource, LmsProviderId } from "@/lib/types"
import { toCourse, toTask } from "../../db/mappers"
import { courses, tasks } from "../../db/schema"
import type { Database } from "../../db/types"
import { AppError, toAppError } from "../../errors"
import { createCourse, updateCourse } from "../../services/courses"
import { createTask, updateTask } from "../../services/tasks"
import { loadLmsCredentials, recordLmsSync } from "./connections"
import type { CredentialVault } from "./credential-vault"
import type { LmsProvider } from "./provider"

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

export async function syncLms(
  db: Database,
  userId: string,
  provider: LmsProvider,
  vault: CredentialVault,
  now: Date = new Date()
): Promise<LmsSyncResult> {
  const result: LmsSyncResult = {
    provider: provider.id,
    coursesCreated: 0,
    coursesUpdated: 0,
    coursesLinked: 0,
    assignmentsCreated: 0,
    assignmentsUpdated: 0,
    assignmentsLinked: 0,
    assignmentsSkipped: 0,
    assignmentsMissing: 0,
    conflicts: [],
    errors: [],
    syncedAt: now.toISOString(),
  }

  try {
    // 2-3, 6. Read from the LMS (outside the transaction: these are network calls).
    const credentials = await loadLmsCredentials(db, userId, provider.id, vault)
    const lmsCourses = (await provider.getCourses(credentials)).filter((c) => c.provider === provider.id)
    const assignments: LmsAssignment[] = []
    for (const course of lmsCourses) {
      assignments.push(
        ...(await provider.getAssignments(credentials, course.externalId)).filter(
          (a) => a.provider === provider.id && a.courseExternalId === course.externalId
        )
      )
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
      const plan = planTasks(await existingTasks(tx, userId), assignments, (id) => courseIdByExternal.get(id), {
        provider: provider.id,
        courseIds: [...courseIdByExternal.values()],
      })
      for (const action of plan.actions) {
        if (action.kind === "skip") {
          result.assignmentsSkipped++
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
    })

    // 9.
    await recordLmsSync(db, userId, provider.id, { syncedAt: now })
    return result
  } catch (error) {
    // Only a safe message is kept or returned; provider errors can contain tokens or URLs.
    const safe = error instanceof AppError ? error.message : `Syncing with ${provider.name} failed. Please try again.`
    await recordLmsSync(db, userId, provider.id, { error: safe }).catch(() => {})
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
