import { and, eq, inArray } from "drizzle-orm"
import type { Course, Task, TaskInput } from "@/lib/types"
import { toTask } from "../db/mappers"
import { syllabusImports, tasks as tasksTable } from "../db/schema"
import type { Database } from "../db/types"
import { createCourse, getCourseForUser, type CourseFields } from "./courses"
import { createTask } from "./tasks"

// Saves a confirmed syllabus import: the course (new or existing), its tasks, and a
// small record of the import. All in one transaction: either everything is saved
// or nothing is. The PDF and its text are never stored.
//
// Safe to retry: the browser sends the same task ids when it retries (e.g. the
// connection dropped after saving), and an import whose tasks already exist is
// returned as it was saved instead of being saved twice.

export type SyllabusImportRequest = {
  course: { kind: "new"; fields: CourseFields } | { kind: "existing"; courseId: string }
  tasks: (Omit<TaskInput, "courseId"> & { id: string })[]
  source: { fileName: string; itemsFound: number }
}

export type SyllabusImportSaved = { course: Course; createdCourse: boolean; tasks: Task[] }

export async function saveSyllabusImport(
  db: Database,
  userId: string,
  request: SyllabusImportRequest
): Promise<SyllabusImportSaved> {
  return db.transaction(async (tx) => {
    const replay = await alreadySaved(tx, userId, request)
    if (replay) return replay

    const course =
      request.course.kind === "existing"
        ? await getCourseForUser(tx, userId, request.course.courseId)
        : await createCourse(tx, userId, request.course.fields)

    const tasks: Task[] = []
    for (const task of request.tasks) tasks.push(await createTask(tx, userId, { ...task, courseId: course.id }))

    await tx.insert(syllabusImports).values({
      userId,
      courseId: course.id,
      fileName: request.source.fileName,
      itemsFound: request.source.itemsFound,
      itemsImported: tasks.length,
    })
    return { course, createdCourse: request.course.kind === "new", tasks }
  })
}

// The same import sent again: its tasks are already saved for this user.
async function alreadySaved(
  db: Database,
  userId: string,
  request: SyllabusImportRequest
): Promise<SyllabusImportSaved | null> {
  const ids = request.tasks.map((task) => task.id)
  if (ids.length === 0) return null
  const rows = await db
    .select()
    .from(tasksTable)
    .where(and(eq(tasksTable.userId, userId), inArray(tasksTable.id, ids)))
  if (rows.length === 0) return null
  const saved = rows.map(toTask)
  const course = await getCourseForUser(db, userId, saved[0].courseId)
  return { course, createdCourse: request.course.kind === "new", tasks: saved }
}
