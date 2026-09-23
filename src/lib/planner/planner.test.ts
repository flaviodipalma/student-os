import { describe, expect, it } from "vitest"
import { toMinutes } from "@/lib/events"
import { DEFAULT_STUDENT_PREFERENCES, plannerSettingsFor } from "@/lib/preferences"
import type { CalendarEvent, RecurringCommitment, Task } from "@/lib/types"
import { buildDayTimeline, calculateTaskUrgency, generatePlan, type StudySession } from "./index"

// A fixed Tuesday, 8:00 AM, so results never depend on the real clock.
const DATE = "2026-09-22"
const NOW = new Date(2026, 8, 22, 8, 0)

let nextId = 0
function task(overrides: Partial<Task> = {}): Task {
  return {
    id: `task-${++nextId}`,
    courseId: "csc215",
    title: "Task",
    description: "",
    type: "assignment",
    dueDate: "2026-09-23",
    priority: "medium",
    estimateMinutes: 60,
    status: "not_started",
    ...overrides,
  }
}

function event(startTime: string, endTime: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: `event-${++nextId}`, title: "Event", date: DATE, startTime, endTime, type: "class", ...overrides }
}

const minutes = (s: StudySession) => toMinutes(s.endTime) - toMinutes(s.startTime)
const overlaps = (s: StudySession, e: CalendarEvent) =>
  s.date === e.date && toMinutes(s.startTime) < toMinutes(e.endTime) && toMinutes(e.startTime) < toMinutes(s.endTime)

// Busy all day except 3:15–6:00 PM.
const busyExceptAfternoon = [
  event("08:00", "10:30"),
  event("10:30", "13:00", { type: "sports", title: "Soccer Practice" }),
  event("13:00", "14:00", { type: "personal" }),
  event("14:00", "15:15", { title: "CSC215 Class" }),
  event("18:00", "22:00", { type: "work" }),
]

describe("generatePlan", () => {
  it("schedules a task in available time", () => {
    const assignment = task({ title: "CSC215 Assignment #2", priority: "high", estimateMinutes: 90 })
    const plan = generatePlan({ date: DATE, tasks: [assignment], events: busyExceptAfternoon, now: NOW })

    expect(plan.status).toBe("ok")
    expect(plan.suggestions).toHaveLength(1)
    const [session] = plan.suggestions
    expect(session).toMatchObject({ taskId: assignment.id, startTime: "15:15", endTime: "16:45", status: "suggested" })
    expect(plan.unscheduled).toEqual([])
  })

  it("never schedules on top of an existing event", () => {
    const events = [
      event("09:00", "09:50"),
      event("10:30", "13:00", { type: "sports" }),
      event("14:00", "15:15"),
      event("16:00", "17:15"),
      event("19:00", "20:00", { type: "personal" }),
      event("12:00", "12:45", { type: "study" }),
    ]
    const tasks = [
      task({ estimateMinutes: 90, priority: "high" }),
      task({ estimateMinutes: 45, dueDate: DATE }),
      task({ estimateMinutes: 120, priority: "critical", dueDate: "2026-09-24" }),
      task({ estimateMinutes: 30, priority: "low" }),
    ]
    const plan = generatePlan({ date: DATE, tasks, events, now: NOW })

    expect(plan.suggestions.length).toBeGreaterThan(0)
    for (const session of plan.suggestions) {
      for (const e of events) expect(overlaps(session, e)).toBe(false)
    }
    // Suggestions don't overlap each other either.
    const sorted = [...plan.suggestions].sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (let i = 1; i < sorted.length; i++) {
      expect(toMinutes(sorted[i].startTime)).toBeGreaterThanOrEqual(toMinutes(sorted[i - 1].endTime))
    }
  })

  it("ignores completed tasks", () => {
    const done = task({ status: "completed", priority: "critical", dueDate: DATE })
    const open = task()
    const plan = generatePlan({ date: DATE, tasks: [done, open], events: [], now: NOW })

    expect(plan.suggestions.map((s) => s.taskId)).toEqual([open.id])
  })

  it("says so when there are no tasks to schedule", () => {
    const plan = generatePlan({ date: DATE, tasks: [task({ status: "completed" })], events: [], now: NOW })
    expect(plan.status).toBe("no-tasks")
    expect(plan.suggestions).toEqual([])
  })

  it("considers more urgent tasks first", () => {
    const later = task({ title: "Later", dueDate: "2026-09-29", priority: "low", estimateMinutes: 60 })
    const soon = task({ title: "Soon", dueDate: "2026-09-23", priority: "high", estimateMinutes: 60 })
    // Only one hour free: 3:00–4:00 PM.
    const events = [event("08:00", "15:00"), event("16:00", "22:00")]
    const plan = generatePlan({ date: DATE, tasks: [later, soon], events, now: NOW, settings: { maxShareOfFreeTime: 1 } })

    expect(plan.suggestions.map((s) => s.taskId)).toEqual([soon.id])
    expect(plan.unscheduled.map((u) => u.taskId)).toEqual([later.id])
  })

  it("respects the daily study limit", () => {
    const tasks = Array.from({ length: 6 }, () => task({ estimateMinutes: 100, priority: "high" }))
    const plan = generatePlan({ date: DATE, tasks, events: [], now: NOW })

    const planned = plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)
    expect(planned).toBeLessThanOrEqual(240)
    expect(plan.studyMinutes).toBeLessThanOrEqual(plan.studyLimit)
    expect(plan.unscheduled.length).toBeGreaterThan(0)
    expect(plan.unscheduled.every((u) => u.reason === "daily-limit")).toBe(true)

    const strict = generatePlan({ date: DATE, tasks, events: [], now: NOW, settings: { maxStudyMinutesPerDay: 60 } })
    expect(strict.suggestions.reduce((sum, s) => sum + minutes(s), 0)).toBeLessThanOrEqual(60)
  })

  it("counts study already on the calendar toward the daily limit", () => {
    const booked = event("08:00", "11:00", { type: "study", title: "Library session" })
    const plan = generatePlan({ date: DATE, tasks: [task({ estimateMinutes: 120 })], events: [booked], now: NOW })

    expect(plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)).toBeLessThanOrEqual(60)
  })

  it("leaves some free time instead of filling every minute", () => {
    // 2 hours free, lots of work due tomorrow.
    const events = [event("08:00", "18:00"), event("20:00", "22:00")]
    const plan = generatePlan({ date: DATE, tasks: [task({ estimateMinutes: 120 })], events, now: NOW })

    const planned = plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)
    expect(planned).toBeLessThan(120)
    expect(planned).toBeGreaterThan(0)
  })

  it("doesn't suggest more study after a suggestion is accepted", () => {
    const events = [event("08:00", "17:15"), event("19:00", "20:00", { type: "personal" })]
    const tasks = [
      task({ estimateMinutes: 90, priority: "high" }),
      task({ estimateMinutes: 60, dueDate: "2026-09-24" }),
      task({ estimateMinutes: 60, dueDate: "2026-09-25" }),
      task({ estimateMinutes: 60, dueDate: "2026-09-26" }),
    ]
    const before = generatePlan({ date: DATE, tasks, events, now: NOW })
    const total = (plan: typeof before) => plan.studyMinutes

    // Accept the first suggestion: it becomes a study event on the calendar.
    const [first] = before.suggestions
    const accepted = event(first.startTime, first.endTime, { type: "study", taskId: first.taskId })
    const after = generatePlan({ date: DATE, tasks, events: [...events, accepted], now: NOW })

    expect(total(after)).toBeLessThanOrEqual(total(before))
    expect(after.suggestions.length).toBeLessThanOrEqual(before.suggestions.length - 1)
  })

  it("splits long tasks into realistic blocks with a break", () => {
    const big = task({ estimateMinutes: 180, priority: "high" })
    const plan = generatePlan({ date: DATE, tasks: [big], events: [], now: NOW })

    expect(plan.suggestions).toHaveLength(2)
    for (const session of plan.suggestions) expect(minutes(session)).toBeLessThanOrEqual(120)
    expect(plan.suggestions.map(minutes)).toEqual([90, 90])
    const [first, second] = plan.suggestions
    expect(toMinutes(second.startTime) - toMinutes(first.endTime)).toBeGreaterThanOrEqual(15)
  })

  it("spreads work that isn't due soon across several days", () => {
    const project = task({ estimateMinutes: 240, dueDate: "2026-10-02" }) // 10 days away
    const plan = generatePlan({ date: DATE, tasks: [project], events: [], now: NOW })

    const planned = plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)
    expect(planned).toBeGreaterThan(0)
    expect(planned).toBeLessThan(240)
  })

  it("schedules what fits when a task needs more time than is free, and flags the rest", () => {
    const events = [event("08:00", "15:00"), event("16:00", "22:00")] // 1 hour free
    const big = task({ estimateMinutes: 120, dueDate: DATE, priority: "high" })
    const plan = generatePlan({ date: DATE, tasks: [big], events, now: NOW, settings: { maxShareOfFreeTime: 1 } })

    expect(plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)).toBe(60)
    expect(plan.unscheduled).toEqual([
      { taskId: big.id, missingMinutes: 60, scheduledMinutes: 60, reason: "no-time", atRisk: true },
    ])
  })

  it("handles a day with no free time", () => {
    const events = [event("07:00", "12:00"), event("12:00", "23:00", { type: "work" })]
    const plan = generatePlan({ date: DATE, tasks: [task({ priority: "critical", dueDate: DATE })], events, now: NOW })

    expect(plan.status).toBe("no-time")
    expect(plan.suggestions).toEqual([])
    expect(plan.unscheduled).toHaveLength(1)
  })

  it("does not duplicate study sessions that already exist", () => {
    const assignment = task({ estimateMinutes: 90 })
    // 60 minutes already booked tomorrow for this task.
    const booked = event("16:00", "17:00", { type: "study", taskId: assignment.id, date: "2026-09-23" })
    const plan = generatePlan({ date: DATE, tasks: [assignment], events: [booked], now: NOW })
    expect(plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)).toBe(30)

    // Fully covered: nothing new to suggest.
    const fullyBooked = { ...booked, endTime: "17:30" }
    const covered = generatePlan({ date: DATE, tasks: [assignment], events: [fullyBooked], now: NOW })
    expect(covered.suggestions).toEqual([])
    expect(covered.status).toBe("no-tasks")
  })

  it("shows existing linked sessions as booked, not as new suggestions", () => {
    const assignment = task({ estimateMinutes: 60 })
    const booked = event("09:00", "10:00", { type: "study", taskId: assignment.id, completed: true })
    const plan = generatePlan({ date: DATE, tasks: [assignment], events: [booked], now: NOW })

    expect(plan.existingSessions).toEqual([
      expect.objectContaining({ taskId: assignment.id, status: "completed", eventId: booked.id }),
    ])
    expect(plan.suggestions).toEqual([])
  })

  it("finishes work due later today before its due time", () => {
    const dueAtNoon = task({ dueDate: DATE, dueTime: "12:00", estimateMinutes: 60 })
    const events = [event("08:00", "10:30")]
    const plan = generatePlan({ date: DATE, tasks: [dueAtNoon], events, now: NOW })

    expect(plan.suggestions).toHaveLength(1)
    expect(toMinutes(plan.suggestions[0].endTime)).toBeLessThanOrEqual(toMinutes("12:00"))
  })

  it("doesn't plan time that has already passed today", () => {
    const afternoon = new Date(2026, 8, 22, 16, 7)
    const plan = generatePlan({ date: DATE, tasks: [task()], events: [], now: afternoon })
    expect(plan.suggestions[0].startTime).toBe("16:15")
  })

  it("plans overdue work today, and nothing for past days", () => {
    const overdue = task({ dueDate: "2026-09-20" })
    expect(generatePlan({ date: DATE, tasks: [overdue], events: [], now: NOW }).suggestions).toHaveLength(1)
    expect(generatePlan({ date: "2026-09-21", tasks: [overdue], events: [], now: NOW }).status).toBe("past")
    // Planning Thursday: a task due Wednesday can no longer be helped that day.
    expect(generatePlan({ date: "2026-09-24", tasks: [task()], events: [], now: NOW }).status).toBe("no-tasks")
  })

  it("leaves out tasks the student skipped", () => {
    const skipped = task()
    const kept = task()
    const plan = generatePlan({ date: DATE, tasks: [skipped, kept], events: [], now: NOW, skippedTaskIds: [skipped.id] })
    expect(plan.suggestions.map((s) => s.taskId)).toEqual([kept.id])
  })
})

describe("generatePlan with student preferences", () => {
  const prefs = (overrides: Partial<typeof DEFAULT_STUDENT_PREFERENCES> = {}) =>
    plannerSettingsFor({ ...DEFAULT_STUDENT_PREFERENCES, ...overrides })

  it("only plans inside the student's study window", () => {
    const plan = generatePlan({
      date: DATE,
      tasks: [task({ estimateMinutes: 60, priority: "high" })],
      events: [],
      now: NOW,
      settings: prefs({ studyStart: "18:00", studyEnd: "21:00" }),
    })
    expect(plan.suggestions).toHaveLength(1)
    expect(toMinutes(plan.suggestions[0].startTime)).toBeGreaterThanOrEqual(toMinutes("18:00"))
    expect(toMinutes(plan.suggestions[0].endTime)).toBeLessThanOrEqual(toMinutes("21:00"))
  })

  it("respects the student's daily maximum", () => {
    const tasks = Array.from({ length: 4 }, () => task({ estimateMinutes: 90, priority: "high" }))
    const plan = generatePlan({ date: DATE, tasks, events: [], now: NOW, settings: prefs({ maxStudyMinutesPerDay: 90 }) })
    expect(plan.studyLimit).toBe(90)
    expect(plan.suggestions.reduce((sum, s) => sum + minutes(s), 0)).toBeLessThanOrEqual(90)
  })

  it("works in the student's preferred block length", () => {
    const plan = (estimateMinutes: number, block: number) =>
      generatePlan({
        date: DATE,
        tasks: [task({ estimateMinutes })],
        events: [],
        now: NOW,
        settings: prefs({ preferredBlockMinutes: block }),
      }).suggestions.map(minutes)
    expect(plan(120, 60)).toEqual([60, 60])
    expect(plan(90, 60)).toEqual([60, 30])
    expect(plan(70, 60)).toEqual([70]) // no 10-minute leftover block
    expect(plan(90, 45)).toEqual([45, 45])
    expect(plan(180, 90)).toEqual([90, 90])
  })

  it("uses the student's break length between blocks", () => {
    const gap = (breakMinutes: number) => {
      const [first, second] = generatePlan({
        date: DATE,
        tasks: [task({ estimateMinutes: 120 })],
        events: [],
        now: NOW,
        settings: prefs({ breakMinutes, preferredBlockMinutes: 60 }),
      }).suggestions
      return toMinutes(second.startTime) - toMinutes(first.endTime)
    }
    expect(gap(0)).toBe(0)
    expect(gap(30)).toBe(30)
  })
})

describe("generatePlan with recurring commitments", () => {
  // 2026-09-22 is a Tuesday.
  const practice: RecurringCommitment = {
    id: "c1",
    title: "Soccer Practice",
    daysOfWeek: [2, 4],
    startTime: "10:30",
    endTime: "13:00",
    type: "sports",
  }

  it("treats a weekly commitment as unavailable on its days", () => {
    // Only 8:00-10:30 and 13:00-22:00 are free once practice is blocked.
    const tasks = [task({ estimateMinutes: 120, priority: "high" }), task({ estimateMinutes: 120 })]
    const plan = generatePlan({ date: DATE, tasks, events: [], now: NOW, recurringCommitments: [practice] })
    expect(plan.suggestions.length).toBeGreaterThan(0)
    for (const session of plan.suggestions) {
      const start = toMinutes(session.startTime)
      const end = toMinutes(session.endTime)
      expect(end <= toMinutes("10:30") || start >= toMinutes("13:00")).toBe(true)
    }
  })

  it("ignores commitments on other days of the week", () => {
    const wednesdayOnly = { ...practice, daysOfWeek: [3] }
    const tasks = [task()]
    const withIt = generatePlan({ date: DATE, tasks, events: [], now: NOW, recurringCommitments: [wednesdayOnly] })
    const without = generatePlan({ date: DATE, tasks, events: [], now: NOW })
    expect(withIt.suggestions).toEqual(without.suggestions)
    expect(withIt.freeMinutes).toBe(without.freeMinutes)
  })

  it("combines with events and the study window", () => {
    // Window 9:00-14:00, practice 10:30-13:00, class 13:00-14:00 -> only 9:00-10:30 is free.
    const events = [event("13:00", "14:00", { title: "CSC215 Class" })]
    const plan = generatePlan({
      date: DATE,
      tasks: [task({ estimateMinutes: 60, dueDate: DATE })],
      events,
      now: NOW,
      recurringCommitments: [practice],
      settings: { ...plannerSettingsFor({ ...DEFAULT_STUDENT_PREFERENCES, studyStart: "09:00", studyEnd: "14:00" }), maxShareOfFreeTime: 1 },
    })
    expect(plan.freeMinutes).toBe(90)
    expect(plan.suggestions).toEqual([expect.objectContaining({ startTime: "09:00", endTime: "10:00" })])
  })
})

describe("calculateTaskUrgency", () => {
  it("ranks closer deadlines higher", () => {
    expect(calculateTaskUrgency(task({ dueDate: DATE }), DATE)).toBeGreaterThan(
      calculateTaskUrgency(task({ dueDate: "2026-09-23" }), DATE)
    )
    expect(calculateTaskUrgency(task({ dueDate: "2026-09-23" }), DATE)).toBeGreaterThan(
      calculateTaskUrgency(task({ dueDate: "2026-09-29" }), DATE)
    )
  })

  it("ranks higher priority higher on the same due date", () => {
    const ranks = (["critical", "high", "medium", "low"] as const).map((priority) =>
      calculateTaskUrgency(task({ priority }), DATE)
    )
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks)
    expect(new Set(ranks).size).toBe(4)
  })
})

describe("buildDayTimeline", () => {
  it("puts events, suggestions, breaks and free time in order", () => {
    const big = task({ estimateMinutes: 180 })
    const events = [event("08:00", "10:30", { title: "Soccer" }), event("18:00", "22:00")]
    const plan = generatePlan({ date: DATE, tasks: [big], events, now: NOW })
    const timeline = buildDayTimeline(plan, events)

    expect(timeline.map((item) => item.kind)).toEqual(["event", "session", "break", "session", "free", "event"])
    expect(timeline.map((item) => item.start)).toEqual(["08:00", "10:30", "12:00", "12:15", "13:45", "18:00"])
  })
})
