import "server-only"

import { and, asc, eq } from "drizzle-orm"
import type { Task, TaskInput } from "@/lib/types"
import { toTask } from "../db/mappers"
import { tasks } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"
import { getCourseForUser } from "./courses"
import { hasChanges } from "./util"

// Nullable fields can be cleared with null on update.
export type TaskChanges = Partial<Omit<TaskInput, "dueTime" | "plannedDate">> & {
  dueTime?: string | null
  plannedDate?: string | null
}

export async function listTasks(db: Database, userId: string): Promise<Task[]> {
  const rows = await db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(asc(tasks.dueDate), asc(tasks.createdAt))
  return rows.map(toTask)
}

export async function getTaskForUser(db: Database, userId: string, taskId: string): Promise<Task> {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
  if (!row) throw new NotFoundError("task")
  return toTask(row)
}

export async function createTask(db: Database, userId: string, input: TaskInput & { id?: string }): Promise<Task> {
  // The course must be one of this user's courses.
  await getCourseForUser(db, userId, input.courseId)
  const [row] = await db
    .insert(tasks)
    .values({
      id: input.id,
      userId,
      courseId: input.courseId,
      title: input.title,
      description: input.description,
      type: input.type,
      dueDate: input.dueDate,
      dueTime: input.dueTime ?? null,
      priority: input.priority,
      estimatedMinutes: input.estimateMinutes,
      notes: input.notes ?? "",
      status: input.status,
      plannedDate: input.plannedDate ?? null,
    })
    .returning()
  return toTask(row)
}

export async function updateTask(db: Database, userId: string, taskId: string, changes: TaskChanges): Promise<Task> {
  if (changes.courseId) await getCourseForUser(db, userId, changes.courseId)
  const values = {
    courseId: changes.courseId,
    title: changes.title,
    description: changes.description,
    type: changes.type,
    dueDate: changes.dueDate,
    dueTime: changes.dueTime,
    priority: changes.priority,
    estimatedMinutes: changes.estimateMinutes,
    notes: changes.notes,
    status: changes.status,
    plannedDate: changes.plannedDate,
  }
  if (!hasChanges(values)) return getTaskForUser(db, userId, taskId)
  const [row] = await db
    .update(tasks)
    .set(values)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning()
  if (!row) throw new NotFoundError("task")
  return toTask(row)
}

export async function deleteTask(db: Database, userId: string, taskId: string): Promise<void> {
  const deleted = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.userId, userId)))
    .returning({ id: tasks.id })
  if (deleted.length === 0) throw new NotFoundError("task")
}
