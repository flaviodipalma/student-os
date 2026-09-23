import { describe, expect, it } from "vitest"
import { toMinutes } from "@/lib/events"
import { addDays } from "@/lib/format"
import { DEFAULT_STUDENT_PREFERENCES, plannerSettingsFor } from "@/lib/preferences"
import { commitmentsOn } from "@/lib/recurring"
import type { CalendarEvent, RecurringCommitment, Task } from "@/lib/types"
import { dayAvailability } from "./availability"
import {
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_SCORING,
  createPlanner,
  generatePlan,
  reasonsOf,
  scoreTask,
  type DailyPlan,
  type PlannerInput,
  type StudySession,
} from "./index"

// The planning engine: scoring, available time, session generation, multi-day
// planning, warnings and determinism. Fixed clock: Tuesday 2026-09-22, 8:00 AM.

const DATE = "2026-09-22"
const TOMORROW = "2026-09-23"
const NOW = new Date(2026, 8, 22, 8, 0)

let nextId = 0
function task(overrides: Partial<Task> = {}): Task {
  const id = `task-${String(++nextId).padStart(3, "0")}`
  return {
    id,
    courseId: "csc215",
    title: `Task ${id}`,
    description: "",
    type: "assignment",
    dueDate: TOMORROW,
    priority: "medium",
    estimateMinutes: 60,
    status: "not_started",
    ...overrides,
  }
}

function event(startTime: string, endTime: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return { id: `event-${++nextId}`, title: "Event", date: DATE, startTime, endTime, type: "class", ...overrides }
}

// Busy all day on `date` except the given "HH:MM-HH:MM" windows (inside 8:00-22:00).
function busyExcept(date: string, ...free: string[]): CalendarEvent[] {
  const events: CalendarEvent[] = []
  let cursor = "08:00"
  for (const window of free) {
    const [start, end] = window.split("-")
    if (start > cursor) events.push(event(cursor, start, { date }))
    cursor = end
  }
  if (cursor < "22:00") events.push(event(cursor, "22:00", { date }))
  return events
}

const minutes = (s: { startTime: string; endTime: string }) => toMinutes(s.endTime) - toMinutes(s.startTime)
const total = (sessions: StudySession[]) => sessions.reduce((sum, s) => sum + minutes(s), 0)
const times = (plan: DailyPlan) => plan.suggestions.map((s) => `${s.startTime}-${s.endTime}`)
// These tests are about how blocks are placed, so they use no transition time after
// fixed events (the transition has its own tests in adaptive.test.ts).
const prefs = (overrides: Partial<typeof DEFAULT_STUDENT_PREFERENCES> = {}) => ({
  ...plannerSettingsFor({ ...DEFAULT_STUDENT_PREFERENCES, ...overrides }),
  transitionMinutes: 0,
})
// Plan with no "leave some free time" share, so tests can reason about exact gaps.
const exact = (overrides: Partial<typeof DEFAULT_STUDENT_PREFERENCES> = {}) => ({ ...prefs(overrides), maxShareOfFreeTime: 1 })

const scoreOf = (t: Task, date = DATE) =>
  scoreTask(t, { date, remainingMinutes: t.estimateMinutes ?? 0, estimateMissing: false, started: false, capacityBeforeDue: Infinity })

// ---------------------------------------------------------------------------

describe("task scoring", () => {
  it("adds up deadline and priority points, with readable reasons", () => {
    const scored = scoreOf(task({ priority: "high", dueDate: TOMORROW }))
    expect(scored.score).toBe(DEFAULT_SCORING.deadline.tomorrow + DEFAULT_SCORING.priority.high)
    expect(reasonsOf(scored)).toEqual(["Due tomorrow", "High priority"])
  })

  it("gives deadlines more points the closer they are, and overdue the most", () => {
    const due = (dueDate: string) => scoreOf(task({ dueDate })).score
    const scores = [due("2026-09-20"), due(DATE), due(TOMORROW), due("2026-09-25"), due("2026-09-29"), due("2026-10-15")]
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
    expect(new Set(scores).size).toBe(scores.length)
    expect(reasonsOf(scoreOf(task({ dueDate: "2026-09-20" })))[0]).toBe("Overdue")
    expect(reasonsOf(scoreOf(task({ dueDate: DATE })))[0]).toBe("Due today")
  })

  it("weighs priority too: a critical task due tomorrow beats a low one due next week", () => {
    const critical = scoreOf(task({ priority: "critical", dueDate: TOMORROW }))
    const low = scoreOf(task({ priority: "low", dueDate: "2026-09-29" }))
    expect(critical.score).toBeGreaterThan(low.score)
    // …but priority isn't everything: a low task due today still beats a critical one due in a week.
    const lowToday = scoreOf(task({ priority: "low", dueDate: DATE }))
    const criticalLater = scoreOf(task({ priority: "critical", dueDate: "2026-09-29" }))
    expect(lowToday.score).toBeGreaterThan(criticalLater.score)
  })

  it("adds points for major work, large tasks, work already started and tight deadlines", () => {
    const exam = scoreTask(task({ type: "exam", dueDate: "2026-09-25" }), {
      date: DATE,
      remainingMinutes: 180,
      estimateMissing: false,
      started: true,
      capacityBeforeDue: 120,
    })
    expect(exam.factors.map((f) => f.key)).toEqual([
      "deadline",
      "priority",
      "major-work",
      "large-task",
      "in-progress",
      "tight-on-time",
    ])
    expect(reasonsOf(exam)).toContain("Exam coming up")
    expect(reasonsOf(exam)).toContain("Large task — started early")
    expect(reasonsOf(exam)).toContain("Tight on time before the deadline")
    expect(exam.score).toBe(exam.factors.reduce((sum, f) => sum + f.points, 0))
  })

  it("uses configurable weights instead of fixed numbers", () => {
    const lowToday = task({ priority: "low", dueDate: DATE, title: "Low today" })
    const criticalLater = task({ priority: "critical", dueDate: "2026-09-29", title: "Critical later" })
    const input = { date: DATE, tasks: [lowToday, criticalLater], events: busyExcept(DATE, "16:00-17:00"), now: NOW }
    const byDefault = generatePlan({ ...input, settings: exact() })
    expect(byDefault.suggestions.map((s) => s.taskId)).toEqual([lowToday.id])

    const priorityFirst = { ...DEFAULT_SCORING, priority: { critical: 500, high: 300, medium: 100, low: 0 } }
    const reweighted = generatePlan({ ...input, settings: { ...exact(), scoring: priorityFirst } })
    expect(reweighted.suggestions.map((s) => s.taskId)).toEqual([criticalLater.id])
  })
})

// ---------------------------------------------------------------------------

describe("available time", () => {
  const settings = { ...DEFAULT_PLANNER_SETTINGS, maxShareOfFreeTime: 1, breakMinutes: 15, transitionMinutes: 0 }
  const soccer: RecurringCommitment = {
    id: "soccer",
    title: "Soccer",
    daysOfWeek: [2],
    startTime: "15:00",
    endTime: "16:00",
    type: "sports",
  }

  it("is the study window minus events, commitments and booked study, with breaks after study", () => {
    const events = [event("10:00", "11:00"), event("13:00", "14:00", { type: "study", taskId: "x" })]
    const day = dayAvailability(DATE, events, [soccer], NOW, settings)
    expect(day.free).toEqual([
      { start: 8 * 60, end: 10 * 60 },
      { start: 11 * 60, end: 13 * 60 },
      { start: 14 * 60, end: 15 * 60 },
      { start: 16 * 60, end: 22 * 60 },
    ])
    expect(day.freeMinutes).toBe(120 + 120 + 60 + 360)
    // A break before and after booked study.
    expect(day.slots[1]).toEqual({ start: 11 * 60, end: 12 * 60 + 45 })
    expect(day.slots[2]).toEqual({ start: 14 * 60 + 15, end: 15 * 60 })
    expect(day.bookedStudyMinutes).toBe(60)
    expect(day.budget).toBe(240 - 60) // the daily limit minus booked study
  })

  it("keeps some free time: the budget is a share of the free time", () => {
    const day = dayAvailability(DATE, busyExcept(DATE, "16:00-18:00"), [], NOW, { ...DEFAULT_PLANNER_SETTINGS, transitionMinutes: 0 })
    expect(day.freeMinutes).toBe(120)
    expect(day.budget).toBe(Math.floor(120 * DEFAULT_PLANNER_SETTINGS.maxShareOfFreeTime))
  })

  it("starts from now, not from the start of the window, today", () => {
    const day = dayAvailability(DATE, [], [], new Date(2026, 8, 22, 16, 7), settings)
    expect(day.free[0].start).toBe(16 * 60 + 15)
    expect(dayAvailability(TOMORROW, [], [], new Date(2026, 8, 22, 16, 7), settings).free[0].start).toBe(8 * 60)
  })

  it("uses the whole study window on a day with no events", () => {
    const plan = generatePlan({ date: DATE, tasks: [task()], events: [], now: NOW, settings: prefs({ studyStart: "09:00", studyEnd: "17:00" }) })
    expect(plan.freeMinutes).toBe(8 * 60)
    expect(plan.suggestions[0].startTime).toBe("09:00")
  })

  it("combines one-time events, weekly commitments and existing study sessions", () => {
    const events = [event("08:00", "09:00"), event("11:00", "12:00", { type: "study", taskId: "other", id: "s1" })]
    const tasks = [task({ estimateMinutes: 480, priority: "critical", dueDate: DATE })]
    const plan = generatePlan({ date: DATE, tasks, events, now: NOW, recurringCommitments: [soccer], settings: exact({ maxStudyMinutesPerDay: 720 }) })
    const busy = [...events, ...commitmentsOn([soccer], DATE)]
    for (const s of plan.suggestions) {
      for (const b of busy) {
        expect(toMinutes(s.endTime) <= toMinutes(b.startTime) || toMinutes(s.startTime) >= toMinutes(b.endTime)).toBe(true)
      }
    }
    expect(plan.suggestions.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------

describe("study session generation", () => {
  it("fills a 4-6 PM gap with two 60-minute sessions for a 2-hour project", () => {
    const project = task({ title: "CSC215 Project", estimateMinutes: 120 })
    const plan = generatePlan({
      date: DATE,
      tasks: [project],
      events: busyExcept(DATE, "16:00-18:00"),
      now: NOW,
      settings: exact({ preferredBlockMinutes: 60, breakMinutes: 0 }),
    })
    expect(times(plan)).toEqual(["16:00-17:00", "17:00-18:00"])
    expect(plan.suggestions.every((s) => s.taskId === project.id)).toBe(true)
  })

  it("adapts to the real gap: 45 or 40 minutes free gets a 45- or 40-minute session", () => {
    const plan = (gap: string) =>
      generatePlan({ date: DATE, tasks: [task({ estimateMinutes: 60 })], events: busyExcept(DATE, gap), now: NOW, settings: exact() })
    expect(times(plan("15:00-15:45"))).toEqual(["15:00-15:45"])
    expect(times(plan("15:00-15:40"))).toEqual(["15:00-15:40"])
    expect(plan("15:00-15:45").suggestions[0].reasons).toContain("Shortened to fit a 45m gap")
    // Too short for a useful block: nothing.
    expect(times(plan("15:00-15:20"))).toEqual([])
  })

  it("prefers the student's block length over many small blocks", () => {
    const plan = generatePlan({ date: DATE, tasks: [task({ estimateMinutes: 120 })], events: [], now: NOW, settings: prefs({ preferredBlockMinutes: 60 }) })
    expect(plan.suggestions.map(minutes)).toEqual([60, 60])
  })

  it("never studies longer than the maximum continuous time", () => {
    const plan = generatePlan({
      date: DATE,
      tasks: [task({ estimateMinutes: 240, priority: "critical" })],
      events: [],
      now: NOW,
      settings: { ...exact({ preferredBlockMinutes: 90 }), maxBlockMinutes: 60 },
    })
    expect(plan.suggestions.every((s) => minutes(s) <= 60)).toBe(true)
  })

  it("splits a long task with a break, and leaves the rest for another day", () => {
    const paper = task({ title: "Research Paper", estimateMinutes: 180, dueDate: TOMORROW })
    const planner = createPlanner({
      tasks: [paper],
      events: busyExcept(DATE, "16:00-18:15"),
      now: NOW,
      settings: exact({ preferredBlockMinutes: 60, breakMinutes: 15 }),
    })
    const today = planner.planFor(DATE)
    expect(times(today)).toEqual(["16:00-17:00", "17:15-18:15"])
    expect(today.unscheduled).toEqual([
      { taskId: paper.id, missingMinutes: 60, scheduledMinutes: 120, reason: "no-time", atRisk: true },
    ])
    // Tomorrow picks up the last hour. Still one task: sessions are the planned work.
    expect(times(planner.planFor(TOMORROW))).toEqual(["08:00-09:00"])
  })

  it("never creates overlapping sessions, across many different days", () => {
    // A deterministic mix of events, commitments and tasks over two weeks.
    const events: CalendarEvent[] = []
    for (let d = 0; d < 14; d++) {
      const date = addDays(DATE, d)
      const h = 8 + (d % 5)
      events.push(event(`${String(h).padStart(2, "0")}:30`, `${String(h + 2).padStart(2, "0")}:00`, { date }))
      if (d % 3 === 0) events.push(event("13:00", "14:15", { date, type: "study", taskId: "booked" }))
      if (d % 4 === 1) events.push(event("17:00", "19:30", { date, type: "work" }))
    }
    const commitments: RecurringCommitment[] = [
      { id: "c1", title: "Soccer", daysOfWeek: [1, 3, 5], startTime: "15:30", endTime: "17:00", type: "sports" },
    ]
    const tasks = Array.from({ length: 12 }, (_, i) =>
      task({
        estimateMinutes: 45 + ((i * 37) % 200),
        dueDate: addDays(DATE, i % 9),
        priority: (["low", "medium", "high", "critical"] as const)[i % 4],
      })
    )
    const planner = createPlanner({ tasks, events, recurringCommitments: commitments, now: NOW, settings: prefs({ preferredBlockMinutes: 45 }) })

    for (let d = 0; d < 14; d++) {
      const date = addDays(DATE, d)
      const plan = planner.planFor(date)
      const busy = [...events.filter((e) => e.date === date), ...commitmentsOn(commitments, date)]
      const sorted = [...plan.suggestions].sort((a, b) => a.startTime.localeCompare(b.startTime))
      for (let i = 0; i < sorted.length; i++) {
        const s = sorted[i]
        if (i > 0) expect(toMinutes(s.startTime)).toBeGreaterThanOrEqual(toMinutes(sorted[i - 1].endTime))
        for (const b of busy) {
          expect(toMinutes(s.endTime) <= toMinutes(b.startTime) || toMinutes(s.startTime) >= toMinutes(b.endTime)).toBe(true)
        }
        expect(toMinutes(s.startTime)).toBeGreaterThanOrEqual(toMinutes("08:00"))
        expect(toMinutes(s.endTime)).toBeLessThanOrEqual(toMinutes("22:00"))
      }
      // New study never goes past the daily limit (study already booked counts toward it).
      const booked = plan.studyMinutes - total(plan.suggestions)
      expect(total(plan.suggestions)).toBeLessThanOrEqual(Math.max(0, plan.studyLimit - booked))
    }
  })
})

// ---------------------------------------------------------------------------

describe("daily study limit", () => {
  it("never recommends more than the limit, and shows what couldn't fit", () => {
    const tasks = Array.from({ length: 5 }, () => task({ estimateMinutes: 120, priority: "high", dueDate: TOMORROW }))
    const plan = generatePlan({ date: DATE, tasks, events: [], now: NOW, settings: prefs({ maxStudyMinutesPerDay: 240 }) })
    expect(total(plan.suggestions)).toBeLessThanOrEqual(240)
    expect(plan.unscheduled.length).toBeGreaterThan(0)
    const warning = plan.warnings.find((w) => w.kind === "unscheduled")!
    expect(warning.message).toBe(`${plan.unscheduled.length} tasks could not fit into today's plan.`)
    expect(warning.action).toBe("plan-next-day")
  })

  it("gives the limited time to the highest-scoring work first", () => {
    const low = task({ priority: "low", dueDate: "2026-09-28", estimateMinutes: 120, title: "Low" })
    const urgent = task({ priority: "critical", dueDate: TOMORROW, estimateMinutes: 120, title: "Urgent" })
    const plan = generatePlan({ date: DATE, tasks: [low, urgent], events: [], now: NOW, settings: prefs({ maxStudyMinutesPerDay: 120 }) })
    expect(new Set(plan.suggestions.map((s) => s.taskId))).toEqual(new Set([urgent.id]))
  })
})

// ---------------------------------------------------------------------------

describe("multi-day planning", () => {
  it("spreads a 3-hour task over three days when each day has one free hour", () => {
    const big = task({ estimateMinutes: 180, dueDate: "2026-09-25" })
    const events = [DATE, TOMORROW, "2026-09-24", "2026-09-25"].flatMap((date) => busyExcept(date, "16:00-17:00"))
    const planner = createPlanner({ tasks: [big], events, now: NOW, settings: exact() })
    expect(times(planner.planFor(DATE))).toEqual(["16:00-17:00"])
    expect(times(planner.planFor(TOMORROW))).toEqual(["16:00-17:00"])
    expect(times(planner.planFor("2026-09-24"))).toEqual(["16:00-17:00"])
    // All of it is planned by then: nothing left for the due date.
    expect(planner.planFor("2026-09-25").suggestions).toEqual([])
    expect(planner.planFor(DATE).suggestions[0].reasons).toContain("Spread over several days (3h left)")
  })

  it("doesn't overload today when later days have room", () => {
    const project = task({ estimateMinutes: 240, dueDate: "2026-10-02" })
    const plan = createPlanner({ tasks: [project], events: [], now: NOW }).planFor(DATE)
    expect(total(plan.suggestions)).toBeGreaterThan(0)
    expect(total(plan.suggestions)).toBeLessThan(240)
  })

  it("does more today when the days before the deadline are full", () => {
    const big = task({ estimateMinutes: 180, dueDate: "2026-09-25" })
    const events = [
      ...busyExcept(DATE, "16:00-19:00"),
      ...busyExcept(TOMORROW), // no free time tomorrow
      ...busyExcept("2026-09-24", "16:00-17:00"),
    ]
    const planner = createPlanner({ tasks: [big], events, now: NOW, settings: exact() })
    expect(total(planner.planFor(DATE).suggestions)).toBe(120)
    expect(total(planner.planFor("2026-09-24").suggestions)).toBe(60)
  })

  it("plans closer deadlines earlier", () => {
    const later = task({ estimateMinutes: 60, dueDate: "2026-09-26", title: "Later" })
    const sooner = task({ estimateMinutes: 60, dueDate: TOMORROW, title: "Sooner" })
    const events = busyExcept(DATE, "16:00-17:00")
    const planner = createPlanner({ tasks: [later, sooner], events, now: NOW, settings: exact() })
    expect(planner.planFor(DATE).suggestions.map((s) => s.taskId)).toEqual([sooner.id])
    expect(planner.planFor(TOMORROW).suggestions.map((s) => s.taskId)).toEqual([later.id])
  })

  it("words deadlines from today, even in a later day's plan", () => {
    const exam = task({ type: "exam", dueDate: TOMORROW, priority: "critical" })
    const tomorrow = createPlanner({ tasks: [exam], events: busyExcept(DATE), now: NOW }).planFor(TOMORROW)
    expect(tomorrow.suggestions[0].reasons[0]).toBe("Due tomorrow")
    // Scored as due that day, though: all of it is planned then.
    expect(tomorrow.ranked[0].factors[0].points).toBe(DEFAULT_SCORING.deadline.today)
  })

  it("returns the same plan object each time a date is asked for", () => {
    const planner = createPlanner({ tasks: [task()], events: [], now: NOW })
    expect(planner.planFor(DATE)).toBe(planner.planFor(DATE))
  })
})

// ---------------------------------------------------------------------------

describe("completed and existing work", () => {
  it("doesn't schedule completed tasks", () => {
    const done = task({ status: "completed", priority: "critical", dueDate: DATE })
    const plan = generatePlan({ date: DATE, tasks: [done], events: [], now: NOW })
    expect(plan.suggestions).toEqual([])
    expect(plan.status).toBe("all-done")
  })

  it("counts completed study sessions as progress", () => {
    const essay = task({ estimateMinutes: 120 })
    const doneYesterday = event("16:00", "17:00", { date: "2026-09-21", type: "study", taskId: essay.id, completed: true })
    const plan = generatePlan({ date: DATE, tasks: [essay], events: [doneYesterday], now: NOW })
    expect(plan.ranked[0].remainingMinutes).toBe(60)
    expect(total(plan.suggestions)).toBe(60)
    expect(plan.suggestions[0].reasons).toContain("Already started")
  })

  it("ignores missed sessions from past days (not marked done)", () => {
    const essay = task({ estimateMinutes: 120 })
    const missed = event("16:00", "17:00", { date: "2026-09-21", type: "study", taskId: essay.id })
    const plan = generatePlan({ date: DATE, tasks: [essay], events: [missed], now: NOW })
    expect(plan.ranked[0].remainingMinutes).toBe(120)
  })

  it("doesn't duplicate work already scheduled, but can add more later", () => {
    const paper = task({ title: "Psychology Paper", estimateMinutes: 180 })
    const booked = event("16:00", "17:00", { type: "study", taskId: paper.id })
    const plan = generatePlan({ date: DATE, tasks: [paper], events: [booked], now: NOW, settings: prefs() })
    expect(total(plan.suggestions)).toBe(120)
    for (const s of plan.suggestions) {
      // Not on top of the booked session, and a break away from it.
      expect(toMinutes(s.endTime) <= toMinutes("15:45") || toMinutes(s.startTime) >= toMinutes("17:15")).toBe(true)
    }
    expect(plan.existingSessions).toEqual([expect.objectContaining({ taskId: paper.id, status: "scheduled" })])
  })
})

// ---------------------------------------------------------------------------

describe("user control", () => {
  it("doesn't recreate a removed recommendation that day, but plans it again the next day", () => {
    const removed = task({ estimateMinutes: 60, dueDate: "2026-09-25", title: "Removed" })
    const planner = createPlanner({ tasks: [removed], events: [], now: NOW, skipped: { [DATE]: [removed.id] } })
    expect(planner.planFor(DATE).suggestions).toEqual([])
    expect(planner.planFor(DATE).skippedTaskIds).toEqual([removed.id])
    expect(planner.planFor(TOMORROW).suggestions.map((s) => s.taskId)).toEqual([removed.id])
  })

  it("warns when important work due tomorrow was removed from today's plan", () => {
    const exam = task({ type: "exam", title: "Biology Exam", dueDate: TOMORROW })
    const plan = createPlanner({ tasks: [exam], events: [], now: NOW, skipped: { [DATE]: [exam.id] } }).planFor(DATE)
    expect(plan.warnings).toEqual([
      expect.objectContaining({
        kind: "due-soon",
        severity: "high",
        message: "Biology Exam is due tomorrow and isn't in today's plan.",
        action: "view-task",
      }),
    ])
  })
})

// ---------------------------------------------------------------------------

describe("difficult situations", () => {
  it("no tasks: all caught up", () => {
    expect(generatePlan({ date: DATE, tasks: [], events: [], now: NOW }).status).toBe("no-tasks")
  })

  it("no available time: no sessions", () => {
    const plan = generatePlan({ date: DATE, tasks: [task({ dueDate: DATE })], events: busyExcept(DATE), now: NOW })
    expect(plan.status).toBe("no-time")
    expect(plan.suggestions).toEqual([])
  })

  it("little available time is flagged", () => {
    const plan = generatePlan({ date: DATE, tasks: [task()], events: busyExcept(DATE, "15:00-15:45"), now: NOW, settings: exact() })
    expect(plan.warnings.map((w) => w.message)).toContain("Your available study time is limited today (45m free).")
  })

  it("overdue tasks are planned today and highlighted", () => {
    const late = task({ title: "Lab Report", dueDate: "2026-09-20", estimateMinutes: 45 })
    const plan = generatePlan({ date: DATE, tasks: [late, task()], events: [], now: NOW })
    expect(plan.ranked[0].task.id).toBe(late.id)
    expect(plan.suggestions.some((s) => s.taskId === late.id && s.reasons[0] === "Overdue")).toBe(true)
    expect(plan.warnings[0]).toMatchObject({ kind: "overdue", message: "Lab Report is overdue.", action: "view-task" })
  })

  it("a task without a usable estimate gets the fallback length and a warning", () => {
    const vague = task({ title: "Read chapter 4", estimateMinutes: 0 })
    const plan = generatePlan({ date: DATE, tasks: [vague], events: [], now: NOW })
    expect(total(plan.suggestions)).toBe(DEFAULT_PLANNER_SETTINGS.fallbackEstimateMinutes)
    expect(plan.warnings).toContainEqual(
      expect.objectContaining({ kind: "no-estimate", severity: "low", taskIds: [vague.id] })
    )
  })

  it("too many tasks: the most important work first, the rest explained, and few warnings", () => {
    const tasks = [
      ...Array.from({ length: 8 }, (_, i) => task({ estimateMinutes: 90, dueDate: TOMORROW, type: i % 2 ? "exam" : "project", priority: "critical" })),
      task({ dueDate: "2026-09-19" }),
      task({ estimateMinutes: 0 }),
    ]
    const plan = generatePlan({ date: DATE, tasks, events: [], now: NOW })
    expect(total(plan.suggestions)).toBeLessThanOrEqual(240)
    expect(plan.unscheduled.length).toBeGreaterThan(0)
    expect(plan.warnings.length).toBeLessThanOrEqual(DEFAULT_PLANNER_SETTINGS.maxWarnings)
    expect(plan.warnings[0].severity).toBe("high")
  })
})

// ---------------------------------------------------------------------------

describe("determinism", () => {
  const input = (): PlannerInput => {
    nextId = 500
    return {
      tasks: [
        task({ estimateMinutes: 120, priority: "high", dueDate: "2026-09-24" }),
        task({ estimateMinutes: 90, dueDate: TOMORROW }),
        task({ estimateMinutes: 60, priority: "high", dueDate: TOMORROW }), // ties with the one above on score
        task({ estimateMinutes: 300, type: "project", dueDate: "2026-09-29" }),
      ],
      events: busyExcept(DATE, "08:00-10:30", "13:00-14:00", "15:15-18:00"),
      now: NOW,
      settings: prefs(),
    }
  }

  it("the same input always gives the same plan", () => {
    const a = createPlanner(input())
    const b = createPlanner(input())
    for (const date of [DATE, TOMORROW, "2026-09-25"]) expect(a.planFor(date)).toEqual(b.planFor(date))
  })

  it("the order tasks come in doesn't matter", () => {
    const forward = input()
    const backward = { ...input(), tasks: [...input().tasks].reverse() }
    expect(createPlanner(backward).planFor(DATE).suggestions).toEqual(createPlanner(forward).planFor(DATE).suggestions)
  })
})
