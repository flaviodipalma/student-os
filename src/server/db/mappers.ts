import type { CalendarEvent, Course, StudySessionRecord, Task } from "@/lib/types"
import type { courses, events, studySessions, tasks } from "./schema"

// Database rows -> the shapes the app already uses (src/lib/types.ts).
// Postgres returns times as "HH:MM:SS"; the app uses "HH:MM".

const hhmm = (time: string) => time.slice(0, 5)

export function toCourse(row: typeof courses.$inferSelect): Course {
  return {
    id: row.id,
    code: row.courseCode,
    name: row.courseName,
    professor: row.professor,
    description: row.description,
    color: row.color,
  }
}

export function toTask(row: typeof tasks.$inferSelect): Task {
  return {
    id: row.id,
    courseId: row.courseId,
    title: row.title,
    description: row.description,
    type: row.type,
    dueDate: row.dueDate,
    dueTime: row.dueTime ? hhmm(row.dueTime) : undefined,
    priority: row.priority,
    estimateMinutes: row.estimatedMinutes,
    status: row.status,
    plannedDate: row.plannedDate ?? undefined,
  }
}

export function toEvent(row: typeof events.$inferSelect): CalendarEvent {
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    startTime: hhmm(row.startTime),
    endTime: hhmm(row.endTime),
    type: row.type,
    description: row.description ?? undefined,
    courseId: row.courseId ?? undefined,
  }
}

export function toStudySession(row: typeof studySessions.$inferSelect): StudySessionRecord {
  return {
    id: row.id,
    taskId: row.taskId,
    date: row.date,
    startTime: hhmm(row.startTime),
    endTime: hhmm(row.endTime),
    status: row.status,
  }
}
