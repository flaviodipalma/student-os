import { describe, expect, it } from "vitest"
import { toMinutes } from "@/lib/events"
import { addDays } from "@/lib/format"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { DEFAULT_LEARNING_SETTINGS, type CalendarEvent, type Course, type RecurringCommitment, type StudySessionRecord, type Task } from "@/lib/types"
import { createPlanner, pickSlot } from "./generate-plan"
import type { PlannerInput } from "./types"
import { whatNow } from "./what-now"

// The Planner with what adaptive planning learned (PlannerInput.learned). It's
// soft: longer or shorter learned estimates and times used last, never study
// over fixed items, outside the study window or past the daily limit.

const TUE = "2026-09-22"
const WED = "2026-09-23"
const at = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number)
  const [h, min] = time.split(":").map(Number)
  return new Date(y, m - 1, d, h, min)
}
let id = 0
const task = (over: Partial<Task> = {}): Task => ({
  id: `task-${++id}`,
  courseId: "csc",
  title: `Task ${id}`,
  description: "",
  type: "assignment",
  dueDate: WED,
  priority: "medium",
  estimateMinutes: 60,
  status: "not_started",
  ...over,
})
const settings = { dayStart: "08:00", dayEnd: "22:00", maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60, breakMinutes: 10, maxShareOfFreeTime: 1 }
const planned = (plan: ReturnType<ReturnType<typeof createPlanner>["planFor"]>, taskId: string) =>
  plan.suggestions.filter((s) => s.taskId === taskId).reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)

describe("learned estimates", () => {
  it("the Planner plans the learned estimate (the task keeps the student's), and says why", () => {
    const t = task()
    const reason = "Adjusted to 1h 30m from your past CSC215 assignments"
    const input: PlannerInput = { tasks: [t], events: [], now: at(TUE, "08:00"), settings, learned: { estimates: { [t.id]: { minutes: 90, reason } } } }
    const planner = createPlanner(input)
    const plan = planner.planFor(TUE)
    expect(planned(plan, t.id)).toBe(90)
    expect(plan.suggestions[0].reasons).toContain(reason)
    expect(planner.estimateOf(t)).toEqual({ minutes: 90, missing: false, learned: { minutes: 90, reason } })
    expect(t.estimateMinutes).toBe(60)
    // Without it: the student's own estimate.
    expect(planned(createPlanner({ ...input, learned: undefined }).planFor(TUE), t.id)).toBe(60)
  })

  it("'What should I do now?' shows the learned remaining work", () => {
    const t = task()
    const planner = createPlanner({ tasks: [t], events: [], now: at(TUE, "08:00"), settings, learned: { estimates: { [t.id]: { minutes: 90, reason: "r" } } } })
    const answer = whatNow({ planner, now: at(TUE, "08:00"), today: TUE, schedule: [], events: [], tasks: [t] })
    expect(answer.kind === "work" && answer.details.remainingMinutes).toBe(90)
  })

  it("big learned estimates never break hard constraints: events, weekly commitments, the daily limit", () => {
    const tasks = [task({ dueDate: TUE }), task({ dueDate: TUE }), task({ dueDate: WED })]
    const events: CalendarEvent[] = [{ id: "class", title: "Class", date: TUE, startTime: "09:00", endTime: "11:00", type: "class" }]
    const commitments: RecurringCommitment[] = [{ id: "soccer", title: "Soccer", daysOfWeek: [2], startTime: "17:00", endTime: "19:00", type: "sports" }]
    const learned = { estimates: Object.fromEntries(tasks.map((t) => [t.id, { minutes: 108, reason: "learned" }])) }
    const plan = createPlanner({ tasks, events, recurringCommitments: commitments, now: at(TUE, "08:00"), settings, learned }).planFor(TUE)
    const total = plan.suggestions.reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)
    expect(total).toBeLessThanOrEqual(240)
    for (const s of plan.suggestions) {
      const [start, end] = [toMinutes(s.startTime), toMinutes(s.endTime)]
      expect(start >= 480 && end <= 1320).toBe(true)
      expect(start < 660 && end > 540).toBe(false)
      expect(start < 1140 && end > 1020).toBe(false)
    }
  })
})

describe("times used last", () => {
  const night = { start: 21 * 60, end: 24 * 60, reason: "Not in the late night: you often miss or move sessions then" }
  const morning = { start: 5 * 60, end: 12 * 60, reason: "Not in the morning: you often miss or move sessions then" }

  it("with other free time, study goes outside the avoided time, and the reason says so", () => {
    const t = task({ dueDate: addDays(WED, 3) })
    // Wednesday: free all day. Morning avoided -> the afternoon.
    const plan = createPlanner({ tasks: [t], events: [], now: at(TUE, "23:00"), settings, learned: { avoidTimes: [morning] } }).planFor(WED)
    expect(plan.suggestions[0].startTime).toBe("12:00")
    expect(plan.suggestions[0].reasons).toContain(morning.reason)
  })

  it("the free time before a later session stays usable (the block is split, not lost)", () => {
    const tasks = [task({ dueDate: WED, estimateMinutes: 120 }), task({ dueDate: WED, estimateMinutes: 120 })]
    const events: CalendarEvent[] = [{ id: "e", title: "Work", date: WED, startTime: "14:00", endTime: "22:00", type: "work" }]
    const plan = createPlanner({ tasks, events, now: at(TUE, "23:00"), settings, learned: { avoidTimes: [{ ...morning, end: 10 * 60 }] } }).planFor(WED)
    const starts = plan.suggestions.map((s) => s.startTime)
    // 10:00-14:00 first (outside the avoided morning), then the avoided 08:00-10:00 is used last.
    expect(starts).toContain("10:00")
    expect(starts).toContain("08:00")
    expect(plan.suggestions.every((s) => toMinutes(s.endTime) <= 14 * 60)).toBe(true)
  })

  it("urgent work still uses avoided time when there's nothing else (never impossible)", () => {
    const t = task({ dueDate: TUE, estimateMinutes: 60 })
    const events: CalendarEvent[] = [{ id: "e", title: "Work", date: TUE, startTime: "08:00", endTime: "20:45", type: "work" }]
    const plan = createPlanner({ tasks: [t], events, now: at(TUE, "07:00"), settings, learned: { avoidTimes: [night] } }).planFor(TUE)
    expect(planned(plan, t.id)).toBe(60)
    expect(toMinutes(plan.suggestions[0].startTime)).toBeGreaterThanOrEqual(21 * 60)
  })

  it("today, the next hour is never avoided: the student is here now", () => {
    const t = task()
    const planner = createPlanner({ tasks: [t], events: [], now: at(TUE, "08:30"), settings, learned: { avoidTimes: [morning] } })
    expect(planner.planFor(TUE).suggestions[0].startTime).toBe("08:30")
    const answer = whatNow({ planner, now: at(TUE, "08:30"), today: TUE, schedule: [], events: [], tasks: [t] })
    expect(answer.kind).toBe("work")
  })

  it("pickSlot: earliest room outside avoided time, else the earliest room", () => {
    const slots = () => [
      { start: 480, end: 720 },
      { start: 780, end: 900 },
    ]
    expect(pickSlot(slots(), 60, 1320, [])).toMatchObject({ start: 480 })
    expect(pickSlot(slots(), 60, 1320, [morning])).toMatchObject({ start: 780, avoided: morning.reason })
    expect(pickSlot(slots(), 60, 1320, [{ start: 0, end: 1440, reason: "all" }])).toMatchObject({ start: 480 })
    expect(pickSlot(slots(), 300, 1320, [])).toBeNull()
  })
})

describe("from saved data (plannerInputFor)", () => {
  const courses = [{ id: "csc", code: "CSC215", name: "DB", professor: "", description: "", color: "sky" }] as Course[]
  const history = () => {
    const done = Array.from({ length: 5 }, () => task({ status: "completed", dueDate: "2026-09-10" }))
    const sessions: StudySessionRecord[] = done.map((t, i) => ({ id: `s${i}`, taskId: t.id, date: "2026-09-15", startTime: "15:00", endTime: "16:30", status: "completed" }))
    return { done, sessions }
  }
  const base = (learning?: { enabled: boolean; since: string | null }) => {
    const { done, sessions } = history()
    const open = task({ dueDate: WED })
    const input = plannerInputFor(
      { tasks: [...done, open], courses, events: [], studySessions: sessions, recurringCommitments: [], preferences: DEFAULT_STUDENT_PREFERENCES, learning: learning && { ...DEFAULT_LEARNING_SETTINGS, ...learning } },
      at(TUE, "08:00")
    )
    return { input, open }
  }

  it("on: learned estimates reach the Planner", () => {
    const { input, open } = base({ ...DEFAULT_LEARNING_SETTINGS, enabled: true, since: null })
    expect(input.learned?.estimates?.[open.id]?.minutes).toBe(80)
  })

  it("off, reset, or no learning settings: the Planner plans exactly as before", () => {
    expect(base({ ...DEFAULT_LEARNING_SETTINGS, enabled: false, since: null }).input.learned).toBeUndefined()
    expect(base({ ...DEFAULT_LEARNING_SETTINGS, enabled: true, since: TUE }).input.learned).toBeUndefined()
    expect(base(undefined).input.learned).toBeUndefined()
  })
})
