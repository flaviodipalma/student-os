import "server-only"

import { and, eq, sql } from "drizzle-orm"
import {
  missingCourses,
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
import { LmsError } from "./provider"

// Syncs one student's LMS data into their normal Student OS courses and tasks.
// The data comes from the browser extension (src/server/integrations/extension),
// already validated and normalized:
//
//   1. the student: always the signed-in user's id (from the session)
//   2-3. the courses the extension sent
//   4-5. match them to existing courses and create / update / link (sync-plan.ts)
//   6. each course's assignments
//   7-8. match them to existing tasks and create / update / link, keeping the
//        student's own changes (three-way merge, conflicts reported)
//   9. record when it synced (or a safe error)
//   10. return a summary (LmsSyncResult)
//
// Reading happens first; all saving happens in one transaction, so a failure
// part-way leaves Student OS as it was. Writes go through the normal course and
// task services, so the same ownership checks and validation apply.
// Imported records are ordinary courses and tasks: the Planner, Dashboard and
// Tasks page need nothing LMS-specific.

// Where a sync reads from: normalized courses and assignments (the extension's
// Canvas or Blackboard import). The sync itself is the same for both.
export type LmsReader = {
  provider: LmsProviderId
  name: string
  getCourses(): Promise<LmsCourse[]>
  getAssignments(courseExternalId: string): Promise<LmsAssignment[]>
  // Only tasks due on/after this date can be reported "missing" (see planTasks).
  missingFrom?: string
  // True when getCourses returns every current course (so absent ones really are gone).
  listsAllCourses?: boolean
}

type SyncOptions = { now?: Date; timeZone?: string }

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
    coursesSkipped: 0,
    assignmentsCreated: 0,
    assignmentsUpdated: 0,
    assignmentsLinked: 0,
    assignmentsSkipped: 0,
    assignmentsWithoutDueDate: 0,
    assignmentsCompleted: 0,
    assignmentsMissing: 0,
    missing: [],
    missingCourses: [],
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
        result.coursesSkipped++
        result.errors.push(`${course.courseName}: ${error.message}`)
      }
    }

    await db.transaction(async (tx) => {
      // One sync at a time per student and LMS (e.g. two tabs): the second waits for nothing, it stops.
      if (!(await tryLock(tx, `lms-sync:${userId}:${provider.id}`))) {
        throw new LmsError("A sync is already running. Please wait for it to finish.")
      }

      // Each item is saved in its own savepoint: one that fails (reported in
      // `errors`) is rolled back alone and the rest of the sync carries on.
      async function each(label: string, work: (sp: Database) => Promise<void>): Promise<boolean> {
        try {
          await tx.transaction(async (sp) => work(sp))
          return true
        } catch (error) {
          result.errors.push(`${label}: ${toAppError(error).message}`)
          return false
        }
      }

      // 4-5. Courses.
      const courseIdByExternal = new Map<string, string>()
      const existingCourseList = await existingCourses(tx, userId)
      for (const action of planCourses(existingCourseList, lmsCourses)) {
        const source = sourceOf(provider.id, action.lms.externalId, action.lms.url)
        let courseId: string | undefined
        const saved = await each(action.lms.courseName, async (sp) => {
          if (action.kind === "create") {
            courseId = (await createCourse(sp, userId, action.fields)).id
            await setCourseSource(sp, userId, courseId, source, action.fields, now)
            return
          }
          if (action.kind === "update") await updateCourse(sp, userId, action.courseId, action.changes)
          await setCourseSource(sp, userId, action.courseId, source, action.synced, now)
          courseId = action.courseId
        })
        // Counted only once saved.
        if (!saved || !courseId) {
          result.coursesSkipped++
          continue
        }
        courseIdByExternal.set(action.lms.externalId, courseId)
        if (action.kind === "create") result.coursesCreated++
        else if (action.kind === "update") result.coursesUpdated++
        else if (action.kind === "link") result.coursesLinked++
      }
      // Imported courses the LMS stopped listing (only a source that lists every course can tell).
      if (reader.listsAllCourses) {
        result.missingCourses = missingCourses(existingCourseList, lmsCourses, provider.id).map((course) => ({
          courseId: course.id,
          name: course.name,
        }))
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
        const saved = await each(action.lms.title, async (sp) => {
          if (action.kind === "create") {
            const created = await createTask(sp, userId, action.input)
            await setTaskSource(sp, userId, created.id, source, action.synced, now)
            return
          }
          if (action.kind === "update") await updateTask(sp, userId, action.taskId, action.changes)
          if (action.complete) await updateTask(sp, userId, action.taskId, { status: "completed" })
          // The LMS's current values become the baseline for the next sync.
          await setTaskSource(sp, userId, action.taskId, source, action.synced, now)
        })
        // Counted only once saved.
        if (!saved) {
          result.assignmentsSkipped++
          continue
        }
        if (action.kind === "create") {
          result.assignmentsCreated++
          if (action.input.status === "completed") result.assignmentsCompleted++
          continue
        }
        if (action.kind === "update") result.assignmentsUpdated++
        else if (action.kind === "link") result.assignmentsLinked++
        else result.assignmentsSkipped++
        if (action.complete) result.assignmentsCompleted++
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

// A transaction-scoped Postgres advisory lock (released at commit/rollback).
export async function tryLock(db: Database, key: string): Promise<boolean> {
  const result = (await db.execute(sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`)) as unknown
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as { locked: boolean }[]
  return rows[0]?.locked === true
}
