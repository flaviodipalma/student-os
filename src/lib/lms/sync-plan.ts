import { findDuplicateTask, normalizeCourseCode } from "@/lib/syllabus/duplicates"
import { defaultEstimateMinutes } from "@/lib/syllabus/review"
import type { Course, LmsProviderId, Task, TaskInput } from "@/lib/types"
import type { LmsAssignment, LmsCourse, LmsSyncConflict } from "./types"

// How LMS data becomes normal Student OS data, as a PLAN: pure functions that
// compare what the LMS says with what the student has, and decide what to do.
// The sync service (src/server/integrations/lms/sync.ts) carries the plan out.
// Nothing here talks to an LMS or the database, so it's easy to test.
//
// Mapping
//   LMS course      -> Student OS course   (one per LMS course, per student)
//   LMS assignment  -> Student OS task     (the same Task the Planner, Dashboard
//                                           and Tasks page already use)
//
// Matching, in order
//   1. By source: provider + external id (a record imported before).
//   2. Otherwise, an existing record the student already has, using the same
//      rules as the syllabus importer (course code; same course + due date +
//      similar title or same type). It's LINKED: it keeps the student's values
//      and gains the LMS source, so it isn't duplicated.
//   3. Otherwise, CREATE a new record.
//
// Who owns what
//   Synced from the LMS:   title, description, due date, due time (+ course code,
//                          name, professor, description for courses)
//   Set once, on create:   type, estimate (the LMS's if stated, else the same
//                          default the syllabus importer uses)
//   Always the student's:  priority, status, planned date, study sessions
//   An assignment submitted in the LMS does NOT complete the task; the student does.
//
// Changes on both sides: a three-way comparison per field
//   base   = the value last synced from the LMS (stored with the record)
//   local  = the record's value now
//   remote = the LMS's value now
//   remote == base          the LMS didn't change it       -> keep local
//   local  == base          only the LMS changed it        -> take remote
//   local  == remote        both agree                     -> nothing to do
//   otherwise               the student changed it too     -> keep the student's
//                           value and report a conflict; base moves to remote, so
//                           the same disagreement isn't reported again, but a
//                           later LMS change is.
//
// Deleted in the LMS: never deleted in Student OS automatically. Imported tasks
// the LMS stopped listing are reported as "missing" for the student to decide.

// ---- Values compared between syncs --------------------------------------------

export type SyncedCourseFields = { code: string; name: string; professor: string; description: string }
export type SyncedTaskFields = { title: string; description: string; dueDate: string; dueTime: string | null }

// Existing records, with the values last synced from the LMS (null = never synced).
export type ExistingCourse = Course & { synced: Partial<SyncedCourseFields> | null }
export type ExistingTask = Task & { synced: Partial<SyncedTaskFields> | null }

export function courseFieldsFrom(lms: LmsCourse): SyncedCourseFields {
  const name = lms.courseName.trim().slice(0, 150) || "Untitled course"
  return {
    // Every Student OS course has a code; without one, the name stands in.
    code: (lms.courseCode?.trim() || name).slice(0, 30),
    name,
    professor: lms.instructor?.trim().slice(0, 120) ?? "",
    description: lms.description?.trim().slice(0, 600) ?? "",
  }
}

export function taskFieldsFrom(lms: LmsAssignment & { dueDate: string }): SyncedTaskFields {
  return {
    title: lms.title.trim().slice(0, 200) || "Untitled assignment",
    description: lms.description?.trim().slice(0, 2000) ?? "",
    dueDate: lms.dueDate,
    dueTime: lms.dueTime,
  }
}

type Merged<T> = { values: T; changed: Partial<T>; conflicts: (keyof T)[] }

// The three-way rule above, for every field.
export function mergeFields<T extends Record<string, string | null>>(base: Partial<T> | null, local: T, remote: T): Merged<T> {
  const values = { ...local }
  const changed: Partial<T> = {}
  const conflicts: (keyof T)[] = []
  for (const key of Object.keys(remote) as (keyof T)[]) {
    // Never synced before (a linked record): the student's values are the baseline.
    const b = base && key in base ? base[key] : local[key]
    const l = local[key]
    const r = remote[key]
    if (r === b || l === r) continue
    if (l === b) {
      values[key] = r
      changed[key] = r
    } else {
      conflicts.push(key)
    }
  }
  return { values, changed, conflicts }
}

// ---- Courses ------------------------------------------------------------------------

export type CourseAction =
  | { kind: "create"; lms: LmsCourse; fields: SyncedCourseFields }
  | { kind: "update"; courseId: string; lms: LmsCourse; changes: Partial<SyncedCourseFields>; synced: SyncedCourseFields }
  | { kind: "link"; courseId: string; lms: LmsCourse; synced: SyncedCourseFields }
  | { kind: "unchanged"; courseId: string; lms: LmsCourse; synced: SyncedCourseFields }

const isFrom = (source: Course["source"], provider: LmsProviderId, externalId: string) =>
  source?.provider === provider && source.externalId === externalId

export function planCourses(existing: ExistingCourse[], lmsCourses: LmsCourse[]): CourseAction[] {
  const claimed = new Set<string>()
  return lmsCourses.map((lms): CourseAction => {
    const remote = courseFieldsFrom(lms)
    const imported = existing.find((course) => isFrom(course.source, lms.provider, lms.externalId))
    if (imported) {
      claimed.add(imported.id)
      const local = { code: imported.code, name: imported.name, professor: imported.professor, description: imported.description }
      const merged = mergeFields(imported.synced, local, remote)
      // Course conflicts aren't reported: the student's course details simply win.
      return Object.keys(merged.changed).length > 0
        ? { kind: "update", courseId: imported.id, lms, changes: merged.changed, synced: remote }
        : { kind: "unchanged", courseId: imported.id, lms, synced: remote }
    }
    // A course the student already has (by hand or from a syllabus), not yet linked to an LMS.
    const code = normalizeCourseCode(remote.code)
    const same = existing.find(
      (course) => !course.source && !claimed.has(course.id) && code !== "" && normalizeCourseCode(course.code) === code
    )
    if (same) {
      claimed.add(same.id)
      return { kind: "link", courseId: same.id, lms, synced: remote }
    }
    return { kind: "create", lms, fields: remote }
  })
}

// ---- Assignments -> tasks ---------------------------------------------------

export type TaskAction =
  | { kind: "create"; lms: LmsAssignment; input: TaskInput; synced: SyncedTaskFields }
  | { kind: "update"; taskId: string; lms: LmsAssignment; changes: Partial<SyncedTaskFields>; synced: SyncedTaskFields }
  | { kind: "link"; taskId: string; lms: LmsAssignment; synced: SyncedTaskFields }
  | { kind: "unchanged"; taskId: string; lms: LmsAssignment; synced: SyncedTaskFields }
  | { kind: "skip"; lms: LmsAssignment; reason: "no-due-date" | "unknown-course" }

export type TaskPlan = {
  actions: TaskAction[]
  conflicts: LmsSyncConflict[]
  // Imported tasks the LMS no longer lists (in the courses that were synced).
  missingTaskIds: string[]
}

export function planTasks(
  existing: ExistingTask[],
  assignments: LmsAssignment[],
  // The Student OS course for an LMS course id (after the course plan is applied).
  courseIdFor: (courseExternalId: string) => string | undefined,
  // What was synced: the provider, and the Student OS courses its assignments were fetched for.
  scope: { provider: LmsProviderId; courseIds: string[] }
): TaskPlan {
  const conflicts: LmsSyncConflict[] = []
  const claimed = new Set<string>()

  const actions = assignments.map((lms): TaskAction => {
    const courseId = courseIdFor(lms.courseExternalId)
    if (!courseId) return { kind: "skip", lms, reason: "unknown-course" }
    if (!lms.dueDate) return { kind: "skip", lms, reason: "no-due-date" }
    const remote = taskFieldsFrom({ ...lms, dueDate: lms.dueDate })

    const imported = existing.find((task) => isFrom(task.source, lms.provider, lms.externalId))
    if (imported) {
      claimed.add(imported.id)
      const local: SyncedTaskFields = {
        title: imported.title,
        description: imported.description,
        dueDate: imported.dueDate,
        dueTime: imported.dueTime ?? null,
      }
      const merged = mergeFields(imported.synced, local, remote)
      for (const field of merged.conflicts) {
        conflicts.push({ taskId: imported.id, title: imported.title, field, studentValue: local[field], lmsValue: remote[field] })
      }
      return Object.keys(merged.changed).length > 0
        ? { kind: "update", taskId: imported.id, lms, changes: merged.changed, synced: remote }
        : { kind: "unchanged", taskId: imported.id, lms, synced: remote }
    }

    // Already in Student OS (added by hand or from a syllabus): link it, don't duplicate it.
    const unlinked = existing.filter((task) => !task.source && !claimed.has(task.id))
    const same = findDuplicateTask({ title: remote.title, dueDate: remote.dueDate, type: lms.type }, courseId, unlinked)
    if (same) {
      claimed.add(same.id)
      return { kind: "link", taskId: same.id, lms, synced: remote }
    }

    return {
      kind: "create",
      lms,
      synced: remote,
      input: {
        courseId,
        title: remote.title,
        description: remote.description,
        type: lms.type,
        dueDate: remote.dueDate,
        dueTime: remote.dueTime ?? undefined,
        priority: "medium",
        estimateMinutes: lms.estimatedMinutes ?? defaultEstimateMinutes[lms.type],
        status: "not_started",
      },
    }
  })

  // Imported from this provider, in a synced course, but no longer in the LMS.
  const listed = new Set(assignments.map((a) => a.externalId))
  const syncedCourses = new Set(scope.courseIds)
  const missingTaskIds = existing
    .filter(
      (task) =>
        task.source?.provider === scope.provider && syncedCourses.has(task.courseId) && !listed.has(task.source.externalId)
    )
    .map((task) => task.id)

  return { actions, conflicts, missingTaskIds }
}
