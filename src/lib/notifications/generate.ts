import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { addDays } from "@/lib/format"
import { commitmentsBetween } from "@/lib/recurring"
import { instantAt, wallClockIn } from "@/lib/time-zone"
import {
  eventSourceNames,
  type CalendarEvent,
  type ExternalEventRecord,
  type NotificationPreferences,
  type NotificationType,
  type RecurringCommitment,
  type StudySessionRecord,
  type Task,
} from "@/lib/types"

// Which reminders should exist right now, from the student's own data. Pure and
// deterministic (same input -> same output; no AI, no clock of its own), so the
// same function can run on a page load, after a sync, or from a scheduled job.
//
// A reminder is returned only once it's due and only while it's still useful:
//   task due soon      from (due - lead) until due
//   important deadline from (due - 1 day) for high/critical tasks, until the regular reminder
//   task overdue       from due, for 7 days (then it's old news)
//   study session soon from (start - lead) until it starts        (scheduled sessions only)
//   study session missed after it ended while still "scheduled", for 2 days
//   event soon         from (start - lead) until it starts        (own, weekly, Canvas, Blackboard)
//   daily plan ready   from the start of the study window, that day only, if there's a plan
// Nothing is returned for completed tasks, skipped or completed sessions, hidden
// external events, or kinds the student turned off. Each reminder has a stable
// `key` (type + what + when), which the service stores uniquely: that's what
// prevents duplicates. Keys include the due/start instant, so a changed due date
// or a moved session is a new reminder, and the old one is never delivered.

export type DesiredNotification = {
  key: string
  type: NotificationType
  title: string
  message: string
  link: string
  scheduledFor: Date
  relatedTaskId: string | null
  relatedStudySessionId: string | null
  relatedEventId: string | null
}

export type NotificationInput = {
  // The real current instant.
  now: Date
  timeZone: string | undefined
  preferences: NotificationPreferences
  // Start of the student's study window ("HH:MM"): when date-only reminders and
  // the daily plan reminder come.
  studyStart: string
  tasks: Task[]
  studySessions: StudySessionRecord[]
  // The student's own one-time events (not study sessions).
  events: CalendarEvent[]
  commitments: RecurringCommitment[]
  externalEvents: ExternalEventRecord[]
  // Today's plan from the Planner (null: not computed).
  plan: { studySessions: number; events: number } | null
}

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE
const OVERDUE_WINDOW = 7 * DAY
const MISSED_WINDOW = 2 * DAY

const pad = (n: number) => String(n).padStart(2, "0")

function localDateKey(instant: Date, timeZone: string | undefined): string {
  const [year, month, day] = wallClockIn(timeZone, instant)
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function clock(instant: Date, timeZone: string | undefined): string {
  return instant.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
}

function weekdayDate(instant: Date, timeZone: string | undefined): string {
  return instant.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" })
}

// "in 15 minutes", "in 1 hour", "today at 5:30 PM", "tomorrow at 9:00 AM", "on Fri, Oct 2 at 9:00 AM".
// `dateOnly`: no clock time ("today", "tomorrow", "on Fri, Oct 2").
export function whenAhead(target: Date, now: Date, timeZone: string | undefined, dateOnly = false): string {
  const today = localDateKey(now, timeZone)
  const day = localDateKey(target, timeZone)
  const minutes = Math.max(1, Math.ceil((target.getTime() - now.getTime()) / MINUTE))
  if (!dateOnly && minutes < 60) return `in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`
  if (!dateOnly && minutes === 60) return "in 1 hour"
  const at = dateOnly ? "" : ` at ${clock(target, timeZone)}`
  if (day === today) return `today${at}`
  if (day === addDays(today, 1)) return `tomorrow${at}`
  return `on ${weekdayDate(target, timeZone)}${at}`
}

// "today at 5:00 PM", "yesterday", "on Mon, Sep 28".
function whenPast(target: Date, now: Date, timeZone: string | undefined, dateOnly: boolean): string {
  const today = localDateKey(now, timeZone)
  const day = localDateKey(target, timeZone)
  if (day === today) return dateOnly ? "today" : `today at ${clock(target, timeZone)}`
  if (day === addDays(today, -1)) return "yesterday"
  return `on ${weekdayDate(target, timeZone)}`
}

const isDone = (task: Task) => task.status === "completed"

export function generateNotifications(input: NotificationInput): DesiredNotification[] {
  const { now, timeZone, preferences: prefs } = input
  if (!prefs.enabled) return []
  const t = now.getTime()
  const lead = prefs.reminderMinutes * MINUTE
  const today = localDateKey(now, timeZone)
  const out: DesiredNotification[] = []
  const taskById = new Map(input.tasks.map((task) => [task.id, task]))

  // ---- Tasks ------------------------------------------------------------------
  for (const task of input.tasks) {
    if (isDone(task)) continue
    // A task without a time is due at the end of its day; its reminders come at the
    // start of the student's study window (on the day, or the day before for "1 day").
    const dateOnly = !task.dueTime
    const due = instantAt(task.dueDate, task.dueTime ?? "23:59", timeZone)
    const dueKey = due.toISOString()
    const link = `/tasks?task=${task.id}`
    const related = { relatedTaskId: task.id, relatedStudySessionId: null, relatedEventId: null, link }

    if (prefs.taskReminders) {
      const remindAt = dateOnly
        ? instantAt(prefs.reminderMinutes >= 1440 ? addDays(task.dueDate, -1) : task.dueDate, input.studyStart, timeZone)
        : new Date(due.getTime() - lead)
      if (remindAt.getTime() <= t && t < due.getTime()) {
        out.push({
          key: `task_due_soon:${task.id}:${dueKey}:${prefs.reminderMinutes}`,
          type: "task_due_soon",
          title: "Due soon",
          message: `${task.title} is due ${whenAhead(due, now, timeZone, dateOnly)}.`,
          scheduledFor: remindAt,
          ...related,
        })
      }
      // High and critical tasks also get a day's notice (when the usual reminder is shorter).
      const important = task.priority === "high" || task.priority === "critical"
      const dayBefore = dateOnly
        ? instantAt(addDays(task.dueDate, -1), input.studyStart, timeZone)
        : new Date(due.getTime() - DAY)
      if (important && prefs.reminderMinutes < 1440 && dayBefore.getTime() <= t && t < remindAt.getTime()) {
        out.push({
          key: `important_deadline:${task.id}:${dueKey}`,
          type: "important_deadline",
          title: "Important deadline",
          message: `${task.title} (${task.priority} priority) is due ${whenAhead(due, now, timeZone, dateOnly)}.`,
          scheduledFor: dayBefore,
          ...related,
        })
      }
    }

    if (prefs.overdueReminders && due.getTime() <= t && t - due.getTime() <= OVERDUE_WINDOW) {
      // Imported tasks may have been turned in without Student OS knowing (feeds don't say).
      const unsure = task.source && task.source.submissionStatus !== "not_submitted"
      out.push({
        key: `task_overdue:${task.id}:${dueKey}`,
        type: "task_overdue",
        title: "Overdue",
        message: `${task.title} was due ${whenPast(due, now, timeZone, dateOnly)}.${unsure ? " If you've turned it in, mark it done." : ""}`,
        scheduledFor: due,
        ...related,
      })
    }
  }

  // ---- Study sessions (the Planner's sessions the student accepted) --------------
  if (prefs.studySessionReminders) {
    for (const session of input.studySessions) {
      if (session.status !== "scheduled") continue
      const task = taskById.get(session.taskId)
      if (!task || isDone(task)) continue
      const start = instantAt(session.date, session.startTime, timeZone)
      const end = instantAt(session.date, session.endTime, timeZone)
      const link = `/planner?date=${session.date}`
      const related = { relatedTaskId: task.id, relatedStudySessionId: session.id, relatedEventId: null, link }
      const startKey = start.toISOString()
      if (start.getTime() - lead <= t && t < start.getTime()) {
        out.push({
          key: `study_session_upcoming:${session.id}:${startKey}:${prefs.reminderMinutes}`,
          type: "study_session_upcoming",
          title: "Study session soon",
          message: `Study session starting ${whenAhead(start, now, timeZone)}: work on ${task.title}.`,
          scheduledFor: new Date(start.getTime() - lead),
          ...related,
        })
      }
      if (end.getTime() <= t && t - end.getTime() <= MISSED_WINDOW) {
        out.push({
          key: `study_session_missed:${session.id}:${startKey}`,
          type: "study_session_missed",
          title: "Missed study session",
          message: `You missed your ${task.title} study session (${whenPast(start, now, timeZone, false)}). Mark it done if you studied, or plan it again.`,
          scheduledFor: end,
          ...related,
        })
      }
    }
  }

  // ---- Calendar events: the student's own, weekly commitments, Canvas, Blackboard ----
  if (prefs.eventReminders) {
    type Upcoming = { ref: string; title: string; start: Date; date: string; source: string | null; external?: string }
    const upcoming: Upcoming[] = []
    for (const event of input.events) {
      upcoming.push({ ref: `event:${event.id}`, title: event.title, start: instantAt(event.date, event.startTime, timeZone), date: event.date, source: null })
    }
    // Occurrences from yesterday (covers time-zone edges) to the lead ahead.
    for (const occurrence of commitmentsBetween(input.commitments, addDays(today, -1), addDays(today, 2))) {
      upcoming.push({
        ref: `commitment:${occurrence.commitmentId}`,
        title: occurrence.title,
        start: instantAt(occurrence.date, occurrence.startTime, timeZone),
        date: occurrence.date,
        source: null,
      })
    }
    // Visible external events, on their first day (a multi-day event starts once).
    const seen = new Set<string>()
    for (const item of externalEventsAsCalendarItems(input.externalEvents, timeZone)) {
      if (!item.externalEventId || seen.has(item.externalEventId)) continue
      seen.add(item.externalEventId)
      const record = input.externalEvents.find((event) => event.id === item.externalEventId)
      if (!record) continue
      upcoming.push({
        ref: `external:${record.id}`,
        title: record.title,
        start: new Date(record.startsAt),
        date: item.date,
        source: eventSourceNames[record.source],
        external: record.id,
      })
    }
    for (const event of upcoming) {
      const remindAt = event.start.getTime() - lead
      if (remindAt <= t && t < event.start.getTime()) {
        out.push({
          key: `event_upcoming:${event.ref}:${event.start.toISOString()}:${prefs.reminderMinutes}`,
          type: "event_upcoming",
          title: event.source ? `${event.source} event` : "Coming up",
          message: `${event.title} starts ${whenAhead(event.start, now, timeZone)}.`,
          link: `/calendar?date=${event.date}${event.external ? `&external=${event.external}` : ""}`,
          scheduledFor: new Date(remindAt),
          relatedTaskId: null,
          relatedStudySessionId: null,
          relatedEventId: event.ref,
        })
      }
    }
  }

  // ---- Today's plan (from the Planner) -----------------------------------------------
  if (prefs.dailyPlanReminder && input.plan) {
    const at = instantAt(today, input.studyStart, timeZone)
    const { studySessions, events } = input.plan
    if (at.getTime() <= t && studySessions + events > 0) {
      const parts = [
        studySessions > 0 && `${studySessions} study ${studySessions === 1 ? "session" : "sessions"}`,
        events > 0 && `${events} ${events === 1 ? "event" : "events"}`,
      ].filter(Boolean)
      out.push({
        key: `daily_plan_ready:${today}`,
        type: "daily_plan_ready",
        title: "Today's plan",
        message: `Your plan for today is ready: ${parts.join(" and ")}.`,
        link: "/planner",
        scheduledFor: at,
        relatedTaskId: null,
        relatedStudySessionId: null,
        relatedEventId: null,
      })
    }
  }

  return out
}
