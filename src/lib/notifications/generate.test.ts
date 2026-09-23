import { describe, expect, it } from "vitest"
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/preferences"
import type { CalendarEvent, ExternalEventRecord, NotificationPreferences, RecurringCommitment, StudySessionRecord, Task } from "@/lib/types"
import { generateNotifications, whenAhead, type NotificationInput } from "./generate"

// Which reminders are due, from plain data: no database, no clock of its own.
// Times are in New York unless a test says otherwise.

const NY = "America/New_York"
// Tuesday, September 29, 2026, 4:00 PM in New York (20:00 UTC).
const NOW = new Date("2026-09-29T20:00:00Z")
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000)

const task = (overrides: Partial<Task> = {}): Task => ({
  id: "task-1",
  courseId: "course-1",
  title: "Database Project",
  description: "",
  type: "assignment",
  dueDate: "2026-09-29",
  dueTime: "16:30",
  priority: "medium",
  estimateMinutes: 60,
  status: "not_started",
  ...overrides,
})
const session = (overrides: Partial<StudySessionRecord> = {}): StudySessionRecord => ({
  id: "session-1",
  taskId: "task-1",
  date: "2026-09-29",
  startTime: "16:15",
  endTime: "17:15",
  status: "scheduled",
  ...overrides,
})

function run(overrides: Partial<NotificationInput> = {}, prefs: Partial<NotificationPreferences> = {}) {
  return generateNotifications({
    now: NOW,
    timeZone: NY,
    preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, dailyPlanReminder: false, ...prefs },
    studyStart: "08:00",
    tasks: [],
    studySessions: [],
    events: [],
    commitments: [],
    externalEvents: [],
    plan: null,
    ...overrides,
  })
}
const summary = (list: ReturnType<typeof run>) => list.map((n) => [n.type, n.message])

describe("task reminders", () => {
  it("a task due in 30 minutes (default timing)", () => {
    const [reminder] = run({ tasks: [task()] })
    expect(reminder).toMatchObject({
      type: "task_due_soon",
      message: "Database Project is due in 30 minutes.",
      link: "/tasks?task=task-1",
      relatedTaskId: "task-1",
      scheduledFor: new Date("2026-09-29T20:00:00Z"),
    })
  })

  it("not before its reminder time, and not after it's due", () => {
    expect(run({ tasks: [task({ dueTime: "17:00" })] })).toEqual([]) // reminder at 4:30 PM
    expect(run({ tasks: [task({ dueTime: "16:30" })], now: minutes(31) }).map((n) => n.type)).toEqual(["task_overdue"])
  })

  it("a task due tomorrow, with a 1-day reminder: 'due tomorrow'", () => {
    const due = task({ title: "Psychology Paper", dueDate: "2026-09-30", dueTime: "16:00" })
    expect(summary(run({ tasks: [due] }, { reminderMinutes: 1440 }))).toEqual([
      ["task_due_soon", "Psychology Paper is due tomorrow at 4:00 PM."],
    ])
  })

  it("a task with no time: reminded at the start of the study window ('due today' / 'due tomorrow')", () => {
    const noTime = task({ dueTime: undefined })
    expect(summary(run({ tasks: [noTime] }))).toEqual([["task_due_soon", "Database Project is due today."]])
    const tomorrow = task({ dueDate: "2026-09-30", dueTime: undefined })
    expect(run({ tasks: [tomorrow] })).toEqual([]) // 30-minute timing: on the day
    expect(summary(run({ tasks: [tomorrow] }, { reminderMinutes: 1440 }))).toEqual([["task_due_soon", "Database Project is due tomorrow."]])
  })

  it("completed tasks never get reminders", () => {
    expect(run({ tasks: [task({ status: "completed" })] })).toEqual([])
    expect(run({ tasks: [task({ dueTime: "12:00", status: "completed" })] })).toEqual([])
  })

  it("an overdue task: one reminder (same key every time), for a week", () => {
    const overdue = task({ dueDate: "2026-09-28", dueTime: "23:59" })
    const first = run({ tasks: [overdue] })
    expect(summary(first)).toEqual([["task_overdue", "Database Project was due yesterday."]])
    expect(run({ tasks: [overdue], now: minutes(120) })[0].key).toBe(first[0].key)
    expect(run({ tasks: [task({ dueDate: "2026-09-20" })] })).toEqual([]) // older than a week
    // Imported tasks may already be turned in: say so.
    const imported = task({ dueDate: "2026-09-28", source: { provider: "canvas", externalId: "1" } })
    expect(run({ tasks: [imported] })[0].message).toContain("If you've turned it in, mark it done.")
  })

  it("a changed due date is a different reminder (new key), and the old one is no longer produced", () => {
    const before = run({ tasks: [task()] })[0]
    const moved = run({ tasks: [task({ dueTime: "16:20" })] })[0]
    expect(moved.key).not.toBe(before.key)
    expect(moved.message).toBe("Database Project is due in 20 minutes.")
    expect(run({ tasks: [task({ dueDate: "2026-10-02" })] })).toEqual([])
  })

  it("high and critical tasks also get a day's notice", () => {
    const important = task({ title: "Final Exam Prep", priority: "critical", dueDate: "2026-09-30", dueTime: "15:00" })
    expect(summary(run({ tasks: [important] }))).toEqual([
      ["important_deadline", "Final Exam Prep (critical priority) is due tomorrow at 3:00 PM."],
    ])
    expect(run({ tasks: [{ ...important, priority: "medium" }] })).toEqual([])
    // Not doubled when the usual reminder is already a day ahead.
    expect(run({ tasks: [important] }, { reminderMinutes: 1440 }).map((n) => n.type)).toEqual(["task_due_soon"])
  })
})

describe("study session reminders", () => {
  const tasks = [task({ dueDate: "2026-10-05" })]

  it("before a scheduled session", () => {
    expect(summary(run({ tasks, studySessions: [session()] }))).toEqual([
      ["study_session_upcoming", "Study session starting in 15 minutes: work on Database Project."],
    ])
    expect(run({ tasks, studySessions: [session()] })[0]).toMatchObject({ link: "/planner?date=2026-09-29", relatedStudySessionId: "session-1" })
  })

  it("completed or skipped sessions, and sessions for completed tasks, get nothing", () => {
    expect(run({ tasks, studySessions: [session({ status: "completed" })] })).toEqual([])
    expect(run({ tasks, studySessions: [session({ status: "skipped" })] })).toEqual([])
    expect(run({ tasks: [task({ dueDate: "2026-10-05", status: "completed" })], studySessions: [session()] })).toEqual([])
  })

  it("a missed session (still 'scheduled' after it ended) - never marked done automatically", () => {
    const earlier = session({ startTime: "13:00", endTime: "14:00" })
    expect(summary(run({ tasks, studySessions: [earlier] }))).toEqual([
      ["study_session_missed", "You missed your Database Project study session (today at 1:00 PM). Mark it done if you studied, or plan it again."],
    ])
  })

  it("a rescheduled session: the reminder follows the new time", () => {
    const moved = session({ startTime: "18:00", endTime: "19:00" })
    expect(run({ tasks, studySessions: [moved] })).toEqual([])
    const reminder = run({ tasks, studySessions: [moved], now: minutes(100) })[0]
    expect(reminder.message).toBe("Study session starting in 20 minutes: work on Database Project.")
    expect(reminder.key).not.toBe(run({ tasks, studySessions: [session()] })[0].key)
  })
})

describe("calendar event reminders", () => {
  const own: CalendarEvent = { id: "event-1", title: "Soccer Practice", date: "2026-09-29", startTime: "16:15", endTime: "18:00", type: "sports" }
  const external = (source: "canvas" | "blackboard", id: string, title: string, startsAt: string, hidden = false): ExternalEventRecord => ({
    id,
    source,
    title,
    description: null,
    startsAt,
    endsAt: new Date(new Date(startsAt).getTime() + 75 * 60_000).toISOString(),
    location: null,
    url: null,
    hidden,
  })
  const weekly: RecurringCommitment = {
    id: "commitment-1",
    title: "Work shift",
    daysOfWeek: [2], // Tuesday
    startTime: "16:20",
    endTime: "20:00",
    type: "work",
  }

  it("the student's own event, a weekly commitment, and Canvas / Blackboard events", () => {
    const list = run({
      events: [own],
      commitments: [weekly],
      externalEvents: [
        external("canvas", "c-1", "CSC215", "2026-09-29T20:30:00Z"),
        external("blackboard", "b-1", "Psychology Meeting", "2026-09-29T20:10:00Z"),
      ],
    })
    expect(list.map((n) => [n.title, n.message, n.relatedEventId, n.link])).toEqual([
      ["Coming up", "Soccer Practice starts in 15 minutes.", "event:event-1", "/calendar?date=2026-09-29"],
      ["Coming up", "Work shift starts in 20 minutes.", "commitment:commitment-1", "/calendar?date=2026-09-29"],
      ["Canvas event", "CSC215 starts in 30 minutes.", "external:c-1", "/calendar?date=2026-09-29&external=c-1"],
      ["Blackboard event", "Psychology Meeting starts in 10 minutes.", "external:b-1", "/calendar?date=2026-09-29&external=b-1"],
    ])
  })

  it("hidden external events and events already started get nothing", () => {
    expect(run({ externalEvents: [external("canvas", "c-1", "CSC215", "2026-09-29T20:30:00Z", true)] })).toEqual([])
    expect(run({ events: [{ ...own, startTime: "15:30" }] })).toEqual([])
  })

  it("a changed external event time gives the reminder for the new time only", () => {
    const moved = run({ externalEvents: [external("canvas", "c-1", "CSC215", "2026-09-29T21:00:00Z")] })
    expect(moved).toEqual([]) // now 5:00 PM: reminder at 4:30 PM
    const later = run({ externalEvents: [external("canvas", "c-1", "CSC215", "2026-09-29T21:00:00Z")], now: minutes(40) })
    expect(later[0].message).toBe("CSC215 starts in 20 minutes.")
  })
})

describe("preferences", () => {
  const everything = {
    tasks: [task(), task({ id: "task-2", title: "Old", dueDate: "2026-09-28" })],
    studySessions: [session({ taskId: "task-2" })],
    events: [{ id: "event-1", title: "Soccer", date: "2026-09-29", startTime: "16:10", endTime: "17:00", type: "sports" as const }],
  }

  it("notifications off: nothing at all", () => {
    expect(run(everything, { enabled: false })).toEqual([])
  })

  it("each kind can be turned off on its own", () => {
    const types = (prefs: Partial<NotificationPreferences>) => run(everything, prefs).map((n) => n.type).sort()
    expect(types({})).toEqual(["event_upcoming", "study_session_upcoming", "task_due_soon", "task_overdue"])
    expect(types({ taskReminders: false })).toEqual(["event_upcoming", "study_session_upcoming", "task_overdue"])
    expect(types({ overdueReminders: false })).toEqual(["event_upcoming", "study_session_upcoming", "task_due_soon"])
    expect(types({ studySessionReminders: false })).toEqual(["event_upcoming", "task_due_soon", "task_overdue"])
    expect(types({ eventReminders: false })).toEqual(["study_session_upcoming", "task_due_soon", "task_overdue"])
  })

  it("reminder timing: 5 minutes, 1 hour", () => {
    expect(run({ tasks: [task()] }, { reminderMinutes: 5 })).toEqual([])
    expect(run({ tasks: [task({ dueTime: "16:04" })] }, { reminderMinutes: 5 })[0].message).toBe("Database Project is due in 4 minutes.")
    expect(run({ tasks: [task({ dueTime: "17:00" })] }, { reminderMinutes: 60 })[0].message).toBe("Database Project is due in 1 hour.")
  })
})

describe("daily plan reminder", () => {
  const plan = { studySessions: 2, events: 3 }

  it("once a day (same key all day), from the start of the study window, only if there's a plan", () => {
    const [daily] = run({ plan }, { dailyPlanReminder: true })
    expect(daily).toMatchObject({
      type: "daily_plan_ready",
      key: "daily_plan_ready:2026-09-29",
      message: "Your plan for today is ready: 2 study sessions and 3 events.",
      link: "/planner",
      scheduledFor: new Date("2026-09-29T12:00:00Z"), // 8:00 AM New York
    })
    expect(run({ plan, now: new Date("2026-09-29T11:59:00Z") }, { dailyPlanReminder: true })).toEqual([])
    expect(run({ plan: { studySessions: 0, events: 0 } }, { dailyPlanReminder: true })).toEqual([])
    expect(run({ plan }, { dailyPlanReminder: false })).toEqual([])
  })
})

describe("time zones", () => {
  it("uses the student's zone: the same moment is 'due in 30 minutes' in New York, not in Tokyo", () => {
    expect(run({ tasks: [task()] }).length).toBe(1)
    // 4:30 PM Tokyo on Sept 29 was hours ago.
    expect(run({ tasks: [task()], timeZone: "Asia/Tokyo" }).map((n) => n.type)).toEqual(["task_overdue"])
  })

  it("a midnight deadline: 11:59 PM on the due day, 'today' until then", () => {
    const lateNight = new Date("2026-09-30T03:40:00Z") // 11:40 PM New York, Sept 29
    const [reminder] = run({ tasks: [task({ dueTime: "23:59" })], now: lateNight })
    expect(reminder.message).toBe("Database Project is due in 19 minutes.")
    const justAfter = new Date("2026-09-30T04:05:00Z") // 12:05 AM Sept 30
    expect(summary(run({ tasks: [task({ dueTime: "23:59" })], now: justAfter }))).toEqual([["task_overdue", "Database Project was due yesterday."]])
  })

  it("follows daylight saving time (Nov 1, 2026: 9:00 AM is 14:00 UTC after the change)", () => {
    const due = task({ dueDate: "2026-11-02", dueTime: "09:00" })
    const [reminder] = run({ tasks: [due], now: new Date("2026-11-02T13:45:00Z") })
    expect(reminder.message).toBe("Database Project is due in 15 minutes.")
  })

  it("words: minutes, today, tomorrow, a weekday", () => {
    expect(whenAhead(minutes(1), NOW, NY)).toBe("in 1 minute")
    expect(whenAhead(minutes(90), NOW, NY)).toBe("today at 5:30 PM")
    expect(whenAhead(minutes(24 * 60), NOW, NY)).toBe("tomorrow at 4:00 PM")
    expect(whenAhead(minutes(3 * 24 * 60), NOW, NY)).toBe("on Fri, Oct 2 at 4:00 PM")
  })
})
