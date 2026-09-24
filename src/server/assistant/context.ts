import { fromMinutes, toMinutes } from "@/lib/events"
import { addDays, fromDateKey, toDateKey } from "@/lib/format"
import { completedMinutesFor, createPlanner, dayAvailability, type Planner } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { eventSourceNames, type CalendarEvent, type Task } from "@/lib/types"
import type { AppData } from "../services/app-data"

// What every Assistant tool works from: the signed-in student's data (loaded on
// the server for their user id only), their current time, and the same Planner
// the app uses (src/lib/planner, via plannerInputFor). Tools never query the
// database themselves and never take a user id.

export type ToolContext = {
  data: AppData
  // The student's wall-clock time (local fields = their time zone) and today's date.
  now: Date
  today: string
  timeZone: string | undefined
  // The planner's own input events: the student's events, Canvas/Blackboard
  // events (not hidden) and study sessions, as calendar items.
  items: CalendarEvent[]
  planner: Planner
}

export function createToolContext(data: AppData, now: Date, timeZone: string | undefined): ToolContext {
  const input = plannerInputFor({ ...data, timeZone }, now)
  return { data, now, today: toDateKey(now), timeZone, items: input.events, planner: createPlanner(input) }
}

// The same availability the Planner uses, for one day. `withoutSessionId` leaves
// one stored session out (to check whether it can move somewhere else that day).
export function availabilityOn(ctx: ToolContext, date: string, withoutSessionId?: string) {
  const items = withoutSessionId ? ctx.items.filter((item) => item.sessionId !== withoutSessionId) : ctx.items
  return dayAvailability(date, items, ctx.data.recurringCommitments, ctx.now, ctx.planner.settings)
}

// ---- Text that came from the student or an LMS: data, never instructions.

// Collapses whitespace and control characters and cuts long text, so a title or
// description can't carry a wall of text (or fake message structure) into the
// model's context. The system prompt tells the model all of it is data.
export function untrusted(text: string | null | undefined, max = 120): string {
  if (!text) return ""
  const clean = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

// ---- Labels the model can repeat as they are (so it doesn't do date maths).

// "Fri, Sep 25"
export function dayLabel(date: string): string {
  return fromDateKey(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

// "Today", "Tomorrow", "Fri, Sep 25"
export function relativeDay(ctx: ToolContext, date: string): string {
  if (date === ctx.today) return "Today"
  if (date === addDays(ctx.today, 1)) return "Tomorrow"
  if (date === addDays(ctx.today, -1)) return "Yesterday"
  return dayLabel(date)
}

// "16:00" -> "4:00 PM"
export function timeLabel(time: string): string {
  return fromDateKey("2000-01-01", time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export const clampTime = (minutes: number) => fromMinutes(Math.max(0, Math.min(minutes, 24 * 60 - 1)))
export const lengthOf = (item: { startTime: string; endTime: string }) => toMinutes(item.endTime) - toMinutes(item.startTime)

export function sourceName(item: Pick<CalendarEvent, "source">): string {
  return item.source && item.source !== "student_os" ? eventSourceNames[item.source] : "Student OS"
}

export function courseCodeOf(ctx: ToolContext, courseId: string | undefined): string | null {
  const course = courseId ? ctx.data.courses.find((c) => c.id === courseId) : undefined
  return course ? untrusted(course.code, 40) : null
}

// Work still to do on a task (estimate − work done); null when there's no estimate.
export function remainingMinutes(ctx: ToolContext, task: Task): number | null {
  if (task.estimateMinutes === null) return null
  if (task.status === "completed") return 0
  return Math.max(0, task.estimateMinutes - completedMinutesFor(task.id, ctx.items))
}

// A task, compact: what most answers need.
export function taskBrief(ctx: ToolContext, task: Task) {
  return {
    taskId: task.id,
    title: untrusted(task.title),
    course: courseCodeOf(ctx, task.courseId),
    type: task.type,
    due: relativeDay(ctx, task.dueDate),
    dueDate: task.dueDate,
    // null = the task has no due time (don't make one up).
    dueTime: task.dueTime ? timeLabel(task.dueTime) : null,
    overdue: task.status !== "completed" && task.dueDate < ctx.today,
    priority: task.priority,
    status: task.status,
    // null = no estimate yet.
    estimateMinutes: task.estimateMinutes,
    remainingMinutes: remainingMinutes(ctx, task),
  }
}
