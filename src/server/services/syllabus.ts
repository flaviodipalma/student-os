import type { Course, Task, TaskInput } from "@/lib/types"
import { syllabusImports } from "../db/schema"
import type { Database } from "../db/types"
import { createCourse, getCourseForUser, type CourseFields } from "./courses"
import { createTask } from "./tasks"

// Saves a confirmed syllabus import: the course (new or existing), its tasks, and a
// small record of the import. All in one transaction: either everything is saved
// or nothing is. The PDF and its text are never stored.

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
