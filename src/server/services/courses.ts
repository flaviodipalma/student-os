import "server-only"

import { and, asc, eq, inArray } from "drizzle-orm"
import { tidyCourseCode } from "@/lib/course-code"
import { pickCourseColor } from "@/lib/course-colors"
import type { Course, RecurringCommitment } from "@/lib/types"
import type { BulkCourseChange } from "@/lib/validation"
import { normalizeCourseCode } from "@/lib/syllabus/duplicates"
import { toCourse } from "../db/mappers"
import { courses, recurringCommitments } from "../db/schema"
import type { Database } from "../db/types"
import { DuplicateError, NotFoundError } from "../errors"
import { listRecurringCommitments } from "./recurring-commitments"
import { hasChanges } from "./util"

// Every function takes the signed-in user's id and only touches that user's rows.

export type CourseFields = { code: string; name: string; professor: string; description: string }

export async function listCourses(db: Database, userId: string): Promise<Course[]> {
  const rows = await db.select().from(courses).where(eq(courses.userId, userId)).orderBy(asc(courses.createdAt))
  return rows.map(toCourse)
}

export async function getCourseForUser(db: Database, userId: string, courseId: string): Promise<Course> {
  const [row] = await db
    .select()
    .from(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
  if (!row) throw new NotFoundError("course")
  return toCourse(row)
}

// "CSC 215" and "CSC215" count as the same course.
async function assertCodeIsFree(db: Database, userId: string, code: string, exceptId?: string) {
  const existing = await listCourses(db, userId)
  const clash = existing.find(
    (course) => course.id !== exceptId && normalizeCourseCode(course.code) === normalizeCourseCode(code)
  )
  if (clash) throw new DuplicateError(`You already have a course with the code ${clash.code}.`)
  return existing
}

export async function createCourse(
  db: Database,
  userId: string,
  input: CourseFields & { id?: string }
): Promise<Course> {
  // One format for codes: "CSC 215" is saved as "CSC215" (src/lib/course-code.ts).
  input = { ...input, code: tidyCourseCode(input.code) }
  const existing = await assertCodeIsFree(db, userId, input.code)
  const [row] = await db
    .insert(courses)
    .values({
      id: input.id,
      userId,
      courseCode: input.code,
      courseName: input.name,
      professor: input.professor,
      description: input.description,
      color: pickCourseColor(existing),
    })
    .returning()
  return toCourse(row)
}

export async function updateCourse(
  db: Database,
  userId: string,
  courseId: string,
  changes: Partial<CourseFields>
): Promise<Course> {
  if (changes.code !== undefined) changes = { ...changes, code: tidyCourseCode(changes.code) }
  if (changes.code !== undefined) await assertCodeIsFree(db, userId, changes.code, courseId)
  const values = {
    courseCode: changes.code,
    courseName: changes.name,
    professor: changes.professor,
    description: changes.description,
  }
  if (!hasChanges(values)) return getCourseForUser(db, userId, courseId)
  const [row] = await db
    .update(courses)
    .set(values)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .returning()
  if (!row) throw new NotFoundError("course")
  return toCourse(row)
}

// Deleting a course also deletes its tasks (and their study sessions).
export async function deleteCourse(db: Database, userId: string, courseId: string): Promise<void> {
  const deleted = await db
    .delete(courses)
    .where(and(eq(courses.id, courseId), eq(courses.userId, userId)))
    .returning({ id: courses.id })
  if (deleted.length === 0) throw new NotFoundError("course")
}

// Several courses at once (Courses page, select mode): delete them (with their
// tasks and class times), set their semester dates (their class times follow),
// mark them online (their class times go) or in person, or give them a color.
// All of them must be the student's; nothing changes otherwise. Returns the
// student's courses and weekly commitments as they are now.
export async function bulkUpdateCourses(
  db: Database,
  userId: string,
  courseIds: string[],
  change: BulkCourseChange
): Promise<{ courses: Course[]; commitments: RecurringCommitment[] }> {
  const ids = [...new Set(courseIds)]
  await db.transaction(async (tx) => {
    const mine = and(eq(courses.userId, userId), inArray(courses.id, ids))
    const owned = await tx.select({ id: courses.id }).from(courses).where(mine)
    if (owned.length !== ids.length) throw new NotFoundError("course")
    const theirClassTimes = and(eq(recurringCommitments.userId, userId), inArray(recurringCommitments.courseId, ids))

    if (change.kind === "delete") {
      await tx.delete(courses).where(mine)
    } else if (change.kind === "dates") {
      await tx.update(courses).set({ termStart: change.from, termEnd: change.until }).where(mine)
      await tx.update(recurringCommitments).set({ startDate: change.from, endDate: change.until }).where(theirClassTimes)
    } else if (change.kind === "online") {
      if (change.online) await tx.delete(recurringCommitments).where(theirClassTimes)
      await tx.update(courses).set({ online: change.online }).where(mine)
    } else {
      await tx.update(courses).set({ color: change.color }).where(mine)
    }
  })
  return { courses: await listCourses(db, userId), commitments: await listRecurringCommitments(db, userId) }
}
