import type { CalendarEvent, Course, StudySessionRecord, Task } from "@/lib/types"

// Study sessions are stored separately from events (they belong to a task), but
// the Calendar, Dashboard and Planner show them as study blocks alongside events.
// This turns sessions into calendar items. Skipped sessions aren't shown.
export function sessionsAsCalendarItems(
  sessions: StudySessionRecord[],
  tasks: Task[],
  courses: Course[]
): CalendarEvent[] {
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const courseById = new Map(courses.map((course) => [course.id, course]))
  return sessions
    .filter((session) => session.status !== "skipped")
    .map((session) => {
      const task = taskById.get(session.taskId)
      const course = task ? courseById.get(task.courseId) : undefined
      return {
        id: session.id,
        sessionId: session.id,
        taskId: session.taskId,
        title: `Study — ${course ? `${course.code} ` : ""}${task?.title ?? "task"}`,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        type: "study" as const,
        courseId: task?.courseId,
        completed: session.status === "completed",
        ...(session.status === "completed" && session.completedMinutes ? { completedMinutes: session.completedMinutes } : {}),
      }
    })
}
