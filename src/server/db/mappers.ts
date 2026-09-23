import type { CalendarEvent, Course, ExternalSource, StudySessionRecord, Task } from "@/lib/types"
import type { courses, events, studySessions, tasks } from "./schema"

// Database rows -> the shapes the app already uses (src/lib/types.ts).
// Postgres returns times as "HH:MM:SS"; the app uses "HH:MM".

const hhmm = (time: string) => time.slice(0, 5)

// Where an imported record came from (undefined for the student's own records).
function sourceOf(row: {
  externalSource: ExternalSource["provider"] | null
  externalId: string | null
  externalUrl: string | null
  externalSynced?: Record<string, string | number | null> | null
}): ExternalSource | undefined {
  if (!row.externalSource || !row.externalId) return undefined
  const status = row.externalSynced?.submissionStatus
  return {
    provider: row.externalSource,
    externalId: row.externalId,
    url: row.externalUrl ?? undefined,
    ...(status === "not_submitted" || status === "submitted" || status === "graded" ? { submissionStatus: status } : {}),
  }
}

export function toCourse(row: typeof courses.$inferSelect): Course {
  return {
    id: row.id,
    code: row.courseCode,
    name: row.courseName,
    professor: row.professor,
    description: row.description,
    color: row.color,
    source: sourceOf(row),
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
    notes: row.notes || undefined,
    status: row.status,
    plannedDate: row.plannedDate ?? undefined,
    source: sourceOf(row),
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
