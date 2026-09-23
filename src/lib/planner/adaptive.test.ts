import { describe, expect, it } from "vitest"
import { sessionsAsCalendarItems } from "@/lib/calendar-items"
import { toMinutes } from "@/lib/events"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { scheduleBetween } from "@/lib/recurring"
import type { CalendarEvent, ExternalEventRecord, RecurringCommitment, StudySessionRecord, Task } from "@/lib/types"
import { createPlanner, whatNow, type DailyPlan, type PlannerInput } from "./index"

// The adaptive planner: remaining work (partly done / missed sessions), transition
// time after fixed events, competing deadlines, "Needs attention", "What should I
// do now?", replanning, duplicates and time zones. Pure: no database, fixed clock.

// Tuesday, September 22, 2026.
const TUE = "2026-09-22"
const WED = "2026-09-23"
const THU = "2026-09-24"
const FRI = "2026-09-25"
const at = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number)
  const [h, min] = time.split(":").map(Number)
  return new Date(y, m - 1, d, h, min)
}

let nextId = 0
const task = (overrides: Partial<Task> = {}): Task => ({
  id: `task-${++nextId}`,
  courseId: "course-1",
  title: "Task",
  description: "",
  type: "assignment",
  dueDate: FRI,
  priority: "medium",
  estimateMinutes: 60,
  status: "not_started",
  ...overrides,
})
const event = (date: string, startTime: string, endTime: string, overrides: Partial<CalendarEvent> = {}): CalendarEvent => ({
  id: `event-${++nextId}`,
  title: "Event",
  date,
  startTime,
  endTime,
  type: "class",
  ...overrides,
})
const session = (t: Task, date: string, startTime: string, endTime: string, overrides: Partial<StudySessionRecord> = {}): StudySessionRecord => ({
  id: `session-${++nextId}`,
  taskId: t.id,
  date,
  startTime,
  endTime,
  status: "scheduled",
  ...overrides,
})

// The planner exactly as the app builds it (plannerInputFor), from saved data.
function plannerFor(
  data: {
    tasks: Task[]
    events?: CalendarEvent[]
    sessions?: StudySessionRecord[]
    commitments?: RecurringCommitment[]
    externalEvents?: ExternalEventRecord[]
    timeZone?: string
    preferences?: Partial<typeof DEFAULT_STUDENT_PREFERENCES>
  },
  now: Date,
  settings: PlannerInput["settings"] = {}
) {
  const input = plannerInputFor(
    {
      tasks: data.tasks,
      courses: [],
      events: data.events ?? [],
      studySessions: data.sessions ?? [],
      recurringCommitments: data.commitments ?? [],
      preferences: { ...DEFAULT_STUDENT_PREFERENCES, ...data.preferences },
      externalEvents: data.externalEvents,
      timeZone: data.timeZone,
    },
    now
  )
  return createPlanner({ ...input, settings: { ...input.settings, ...settings } })
}
const slots = (plan: DailyPlan) => plan.suggestions.map((s) => `${s.startTime}-${s.endTime}`)
const minutesPlanned = (plan: DailyPlan, t: Task) =>
  plan.suggestions.filter((s) => s.taskId === t.id).reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)

describe("available time", () => {
  it("leaves a transition after a fixed event: no study starts the minute class ends", () => {
    const essay = task({ estimateMinutes: 60, dueDate: TUE })
    const plan = plannerFor({ tasks: [essay], events: [event(TUE, "08:00", "15:15"), event(TUE, "17:00", "22:00")] }, at(TUE, "07:00")).planFor(TUE)
    expect(slots(plan)).toEqual(["15:30-16:30"])
    // The transition is a setting (0 = none).
    const none = plannerFor({ tasks: [essay], events: [event(TUE, "08:00", "15:15"), event(TUE, "17:00", "22:00")] }, at(TUE, "07:00"), { transitionMinutes: 0 })
    expect(slots(none.planFor(TUE))).toEqual(["15:15-16:15"])
  })

  it("Canvas and Blackboard events are unavailable time, like the student's own", () => {
    const essay = task({ estimateMinutes: 60, dueDate: TUE })
    const external = (id: string, source: "canvas" | "blackboard", startsAt: Date, endsAt: Date): ExternalEventRecord => ({
      id,
      source,
      title: id,
      description: null,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      location: null,
      url: null,
      hidden: false,
    })
    // 8 AM - 8 PM busy except 1-2 PM, via one Canvas and one Blackboard event.
    const plan = plannerFor(
      {
        tasks: [essay],
        externalEvents: [external("canvas", "canvas", at(TUE, "08:00"), at(TUE, "13:00")), external("bb", "blackboard", at(TUE, "14:00"), at(TUE, "22:00"))],
      },
      at(TUE, "07:00"),
      { maxShareOfFreeTime: 1 }
    ).planFor(TUE)
    expect(slots(plan)).toEqual(["13:15-14:00"])
  })
})

describe("remaining work", () => {
  it("a partly done session counts only the minutes worked (90 planned, 45 done -> 45 left)", () => {
    const reading = task({ title: "Psychology Reading", estimateMinutes: 90, dueDate: WED })
    const partly = session(reading, "2026-09-21", "18:00", "19:30", { status: "completed", completedMinutes: 45 })
    const plan = plannerFor({ tasks: [reading], sessions: [partly] }, at(TUE, "07:00")).planFor(TUE)
    expect(plan.ranked[0].remainingMinutes).toBe(45)
    expect(minutesPlanned(plan, reading)).toBe(45)
    // Today: a partly done session counts the minutes worked against the daily limit.
    const today = session(reading, TUE, "08:00", "09:30", { status: "completed", completedMinutes: 30 })
    const withToday = plannerFor({ tasks: [reading], sessions: [today] }, at(TUE, "10:00")).planFor(TUE)
    expect(withToday.studyMinutes).toBe(30 + minutesPlanned(withToday, reading))
    // Fully done: nothing left.
    const done = plannerFor({ tasks: [reading], sessions: [{ ...partly, completedMinutes: null }] }, at(TUE, "07:00")).planFor(TUE)
    expect(done.ranked).toEqual([])
  })

  it("a missed session (earlier today) isn't counted: its work is planned again, and flagged", () => {
    const project = task({ title: "Database Project", estimateMinutes: 60, dueDate: WED })
    const missed = session(project, TUE, "13:00", "14:00")
    const plan = plannerFor({ tasks: [project], sessions: [missed] }, at(TUE, "16:00")).planFor(TUE)
    expect(plan.existingSessions).toEqual([expect.objectContaining({ status: "missed", taskId: project.id })])
    expect(minutesPlanned(plan, project)).toBe(60)
    expect(plan.ranked[0].factors.map((f) => f.key)).toContain("missed-session")
    expect(plan.warnings.find((w) => w.kind === "missed")?.message).toBe(
      "You missed a study session for Database Project. Its work is back in your plan."
    )
    // Before it ends, it still counts as booked.
    const during = plannerFor({ tasks: [project], sessions: [missed] }, at(TUE, "13:30")).planFor(TUE)
    expect(during.ranked).toEqual([])
    expect(during.existingSessions[0].status).toBe("scheduled")
  })

  it("a missed session yesterday: rescheduled today within the daily limit", () => {
    const project = task({ title: "Database Project", estimateMinutes: 60, dueDate: FRI })
    const plan = plannerFor(
      { tasks: [project], sessions: [session(project, "2026-09-21", "17:00", "18:00")], preferences: { maxStudyMinutesPerDay: 30 } },
      at(TUE, "07:00")
    ).planFor(TUE)
    expect(minutesPlanned(plan, project)).toBe(30)
    expect(plan.studyMinutes).toBeLessThanOrEqual(30)
  })
})

describe("scoring: competing deadlines", () => {
  it("a task that fits alone but not with the other work due by then gets a boost and says why", () => {
    const a = task({ title: "A", dueDate: WED, estimateMinutes: 120 })
    const b = task({ title: "B", dueDate: WED, estimateMinutes: 120 })
    // Only 3 hours of study time today (budget), nothing else before Wednesday.
    const planner = plannerFor({ tasks: [a, b], events: [event(TUE, "08:00", "17:00"), event(TUE, "20:00", "22:00")] }, at(TUE, "07:00"), { maxShareOfFreeTime: 1 })
    const ranked = planner.planFor(TUE).ranked
    expect(ranked.every((s) => s.factors.some((f) => f.key === "competing-deadlines"))).toBe(true)
    expect(ranked[0].factors.find((f) => f.key === "competing-deadlines")?.label).toBe("Other deadlines compete for the same time")
  })
})

describe("Needs attention: not enough time", () => {
  it("says how much work is left and how much study time there is before the deadline (facts, no changes)", () => {
    const project = task({ title: "Database Project", estimateMinutes: 240, dueDate: WED })
    // Only 8-9 PM free today and tomorrow.
    const busy = [TUE, WED].flatMap((d) => [event(d, "08:00", "20:00"), event(d, "21:00", "22:00")])
    const plan = plannerFor({ tasks: [project], events: busy }, at(TUE, "07:00"), { maxShareOfFreeTime: 1, transitionMinutes: 0 }).planFor(TUE)
    expect(plan.warnings.find((w) => w.kind === "not-enough-time")).toMatchObject({
      severity: "high",
      message: "Database Project: 4h left, but only about 2h of study time before it's due tomorrow.",
    })
  })

  it("no study time at all before the deadline", () => {
    const paper = task({ title: "Psychology Paper", estimateMinutes: 60, dueDate: TUE, dueTime: "23:00" })
    const plan = plannerFor({ tasks: [paper], events: [event(TUE, "08:00", "22:00")] }, at(TUE, "07:00")).planFor(TUE)
    expect(plan.warnings.find((w) => w.kind === "not-enough-time")?.message).toBe(
      "Psychology Paper is due today, with 1h left and no study time available before it."
    )
  })
})

describe("multi-day planning", () => {
  it("spreads a 4-hour project due Friday over the days before it, instead of cramming", () => {
    const project = task({ title: "Database Project", estimateMinutes: 240, dueDate: FRI, priority: "high" })
    // One free evening hour-and-a-half each day (6-7:30 PM).
    const busy = [TUE, WED, THU, FRI].flatMap((d) => [event(d, "08:00", "18:00"), event(d, "19:30", "22:00")])
    const planner = plannerFor({ tasks: [project], events: busy }, at(TUE, "07:00"), { maxShareOfFreeTime: 1, transitionMinutes: 0 })
    const perDay = [TUE, WED, THU, FRI].map((d) => minutesPlanned(planner.planFor(d), project))
    expect(perDay.reduce((a, b) => a + b, 0)).toBe(240)
    expect(perDay.filter((m) => m > 0).length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...perDay)).toBeLessThanOrEqual(90)
  })

  it("never plans a block longer than 2 hours without a break", () => {
    const big = task({ estimateMinutes: 300, dueDate: TUE })
    const plan = plannerFor({ tasks: [big], preferences: { maxStudyMinutesPerDay: 600, preferredBlockMinutes: 90 } }, at(TUE, "07:00"), { maxShareOfFreeTime: 1 }).planFor(TUE)
    for (const s of plan.suggestions) expect(toMinutes(s.endTime) - toMinutes(s.startTime)).toBeLessThanOrEqual(120)
    for (let i = 1; i < plan.suggestions.length; i++) {
      expect(toMinutes(plan.suggestions[i].startTime)).toBeGreaterThan(toMinutes(plan.suggestions[i - 1].endTime))
    }
  })
})

describe("replanning and duplicates", () => {
  const project = task({ title: "Database Project", estimateMinutes: 120, dueDate: THU })

  it("the same data gives the same plan, with the same recommendation ids (page loads, Dashboard + Planner)", () => {
    const first = plannerFor({ tasks: [project] }, at(TUE, "07:00")).planFor(TUE)
    const second = plannerFor({ tasks: [project] }, at(TUE, "07:00")).planFor(TUE)
    expect(second.suggestions).toEqual(first.suggestions)
    expect(first.suggestions.map((s) => s.id)).toEqual(first.suggestions.map((s) => `${project.id}@${TUE}T${s.startTime}`))
  })

  it("an accepted recommendation isn't recommended again (no duplicate session)", () => {
    const dueTomorrow = { ...project, dueDate: WED }
    const first = plannerFor({ tasks: [dueTomorrow] }, at(TUE, "07:00")).planFor(TUE)
    const accepted = first.suggestions.map((s) => session(dueTomorrow, s.date, s.startTime, s.endTime))
    const again = plannerFor({ tasks: [dueTomorrow], sessions: accepted }, at(TUE, "07:00")).planFor(TUE)
    expect(again.suggestions).toEqual([])
    expect(again.existingSessions.map((s) => `${s.startTime}-${s.endTime}`)).toEqual(slots(first))
  })

  it("a manually scheduled session is respected: planned around, never duplicated", () => {
    const other = task({ title: "Reading", estimateMinutes: 60, dueDate: THU })
    const manual = session(project, TUE, "08:00", "10:00")
    const plan = plannerFor({ tasks: [project, other], sessions: [manual] }, at(TUE, "07:00")).planFor(TUE)
    expect(plan.suggestions.every((s) => s.taskId !== project.id)).toBe(true)
    expect(plan.suggestions.every((s) => toMinutes(s.startTime) >= 10 * 60)).toBe(true)
  })

  it("a skipped (rejected) task isn't recommended again that day, but comes back the next", () => {
    const skipped = session(project, TUE, "08:00", "09:00", { status: "skipped" })
    const planner = plannerFor({ tasks: [project], sessions: [skipped] }, at(TUE, "07:00"))
    expect(planner.planFor(TUE).suggestions).toEqual([])
    expect(planner.planFor(WED).suggestions.length).toBeGreaterThan(0)
  })

  it("follows changes: completed, deadline moved, event added or moved", () => {
    const base = plannerFor({ tasks: [project] }, at(TUE, "07:00")).planFor(TUE)
    expect(slots(base)[0]).toBe("08:00-09:00")
    expect(plannerFor({ tasks: [{ ...project, status: "completed" }] }, at(TUE, "07:00")).planFor(TUE).suggestions).toEqual([])
    const later = plannerFor({ tasks: [{ ...project, dueDate: "2026-10-09" }] }, at(TUE, "07:00")).planFor(TUE)
    expect(minutesPlanned(later, project)).toBeLessThan(minutesPlanned(base, project))
    const withClass = plannerFor({ tasks: [project], events: [event(TUE, "08:00", "12:00")] }, at(TUE, "07:00")).planFor(TUE)
    expect(slots(withClass)[0]).toBe("12:15-13:15")
    const moved = plannerFor({ tasks: [project], events: [event(TUE, "08:00", "10:00")] }, at(TUE, "07:00")).planFor(TUE)
    expect(slots(moved)[0]).toBe("10:15-11:15")
  })
})

describe("What should I do now?", () => {
  const now = (planner: ReturnType<typeof plannerFor>, time: Date, data: { tasks: Task[]; events?: CalendarEvent[]; sessions?: StudySessionRecord[] }) => {
    const items = [...(data.events ?? []), ...sessionsAsCalendarItems(data.sessions ?? [], data.tasks, [])]
    return whatNow({ planner, now: time, today: TUE, schedule: scheduleBetween(items, [], TUE, TUE), events: items, tasks: data.tasks })
  }

  it("free now: work on the plan's first task, with the free time and 'Why this?' from the real factors", () => {
    const project = task({ title: "Database Project", estimateMinutes: 90, dueDate: THU, priority: "high" })
    const data = { tasks: [project], events: [event(TUE, "17:00", "18:00", { title: "Dinner", type: "personal" })] }
    const answer = now(plannerFor(data, at(TUE, "16:00")), at(TUE, "16:00"), data)
    expect(answer).toMatchObject({ kind: "work", task: { title: "Database Project" }, availableMinutes: 60, details: { remainingMinutes: 90 } })
    if (answer.kind !== "work") throw new Error()
    expect(answer.reasons).toEqual(expect.arrayContaining(["Due in 2 days", "High priority", "You have 1h free right now"]))
  })

  it("busy now (class): no study recommended; says when it ends and what's next", () => {
    const project = task({ title: "Database Project", estimateMinutes: 60, dueDate: THU })
    const data = { tasks: [project], events: [event(TUE, "14:00", "15:15", { title: "CSC215" })] }
    const answer = now(plannerFor(data, at(TUE, "14:30")), at(TUE, "14:30"), data)
    expect(answer).toMatchObject({ kind: "busy", event: { title: "CSC215" }, until: "15:15", next: { task: { title: "Database Project" }, startTime: "15:30" } })
  })

  it("inside an accepted study session: keep going", () => {
    const project = task({ title: "Database Project", estimateMinutes: 120, dueDate: THU })
    const data = { tasks: [project], sessions: [session(project, TUE, "16:00", "17:00")] }
    const answer = now(plannerFor(data, at(TUE, "16:20")), at(TUE, "16:20"), data)
    expect(answer).toMatchObject({ kind: "studying", until: "17:00", task: { title: "Database Project" } })
  })

  it("no time now: the next realistic opportunity (later today, or tomorrow)", () => {
    const project = task({ title: "Database Project", estimateMinutes: 60, dueDate: THU })
    // Busy until 6 PM, free 6-7 PM.
    const data = { tasks: [project], events: [event(TUE, "08:00", "15:30"), event(TUE, "15:40", "18:00"), event(TUE, "19:00", "22:00")] }
    const gap = now(plannerFor(data, at(TUE, "15:31")), at(TUE, "15:31"), data)
    expect(gap).toMatchObject({ kind: "no-time", reason: "no-gap", next: { date: TUE, task: { title: "Database Project" } } })
    const late = now(plannerFor(data, at(TUE, "22:30")), at(TUE, "22:30"), data)
    expect(late).toMatchObject({ kind: "no-time", reason: "outside-window", next: { date: WED } })
  })

  it("daily limit reached: next opportunity is tomorrow", () => {
    const project = task({ title: "Database Project", estimateMinutes: 180, dueDate: FRI })
    const data = { tasks: [project], sessions: [session(project, TUE, "08:00", "09:00", { status: "completed" })] }
    const planner = plannerFor({ ...data, preferences: { maxStudyMinutesPerDay: 60 } }, at(TUE, "10:00"))
    expect(now(planner, at(TUE, "10:00"), data)).toMatchObject({ kind: "no-time", reason: "limit-reached", next: { date: WED } })
  })

  it("several competing tasks: the one the plan puts first", () => {
    const low = task({ title: "Low later", priority: "low", dueDate: "2026-10-05" })
    const quiz = task({ title: "Programming Quiz", priority: "high", dueDate: WED, estimateMinutes: 30 })
    const data = { tasks: [low, quiz] }
    expect(now(plannerFor(data, at(TUE, "16:00")), at(TUE, "16:00"), data)).toMatchObject({ kind: "work", task: { title: "Programming Quiz" } })
  })

  it("nothing to do: done", () => {
    const data = { tasks: [task({ status: "completed" })] }
    expect(now(plannerFor(data, at(TUE, "16:00")), at(TUE, "16:00"), data)).toMatchObject({ kind: "done", reason: "all-done" })
  })
})

describe("a realistic day (Tuesday)", () => {
  // 10:30-1:00 Soccer, 2:00-3:15 CSC215, 5:00-6:00 Dinner (weekly), study window 8 AM-10 PM,
  // but mornings are for class prep, so the student is busy 8:00-10:30 too.
  const soccer: RecurringCommitment = { id: "soccer", title: "Soccer Practice", daysOfWeek: [1, 2, 3, 4, 5], startTime: "10:30", endTime: "13:00", type: "sports" }
  const dinner: RecurringCommitment = { id: "dinner", title: "Dinner", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "17:00", endTime: "18:00", type: "personal" }
  const events = [
    event(TUE, "08:00", "10:30", { title: "Morning classes" }),
    event(TUE, "14:00", "15:15", { title: "CSC215" }),
    event(TUE, "19:00", "22:00", { title: "Work shift", type: "work" }),
  ]
  const project = task({ title: "Database Project", priority: "high", estimateMinutes: 180, dueDate: FRI, type: "project" })
  const reading = task({ title: "Psychology Reading", priority: "medium", estimateMinutes: 45, dueDate: THU })
  const quiz = task({ title: "Programming Quiz", priority: "high", estimateMinutes: 30, dueDate: WED, type: "quiz" })
  const data = { tasks: [project, reading, quiz], events, commitments: [soccer, dinner] }

  it("uses the free periods, never soccer, class, dinner or work; the quiz due tomorrow comes first", () => {
    const planner = plannerFor(data, at(TUE, "07:30"))
    const plan = planner.planFor(TUE)
    const busy = [
      ["08:00", "10:30"],
      ["10:30", "13:00"],
      ["14:00", "15:15"],
      ["17:00", "18:00"],
      ["19:00", "22:00"],
    ].map(([s, e]) => [toMinutes(s), toMinutes(e)])
    for (const s of plan.suggestions) {
      for (const [bs, be] of busy) expect(toMinutes(s.startTime) < be && bs < toMinutes(s.endTime), `${s.startTime} overlaps`).toBe(false)
    }
    // Not after class without a transition, and not every free minute.
    expect(plan.suggestions.every((s) => s.startTime !== "15:15")).toBe(true)
    expect(plan.studyMinutes).toBeLessThan(plan.freeMinutes)
    expect(plan.suggestions[0].taskId).toBe(quiz.id)
    // The quiz is all planned today (due tomorrow); the project is spread out.
    expect(minutesPlanned(plan, quiz)).toBe(30)
    const projectDays = [TUE, WED, THU].map((d) => minutesPlanned(planner.planFor(d), project))
    expect(projectDays.filter((m) => m > 0).length).toBeGreaterThanOrEqual(2)
  })

  it("at 3:30 PM: work on the quiz, with the reasons", () => {
    const planner = plannerFor(data, at(TUE, "15:30"))
    const schedule = scheduleBetween(events, [soccer, dinner], TUE, TUE)
    const answer = whatNow({ planner, now: at(TUE, "15:30"), today: TUE, schedule, events, tasks: data.tasks })
    expect(answer).toMatchObject({ kind: "work", task: { title: "Programming Quiz" }, availableMinutes: 90 })
    if (answer.kind === "work") expect(answer.reasons).toEqual(expect.arrayContaining(["Due tomorrow", "High priority", "You have 1h 30m free right now"]))
  })

  it("during soccer practice: busy, not study", () => {
    const planner = plannerFor(data, at(TUE, "11:00"))
    const schedule = scheduleBetween(events, [soccer, dinner], TUE, TUE)
    expect(whatNow({ planner, now: at(TUE, "11:00"), today: TUE, schedule, events, tasks: data.tasks })).toMatchObject({
      kind: "busy",
      event: { title: "Soccer Practice" },
      until: "13:00",
    })
  })
})

describe("time zones", () => {
  it("an external event is busy at the student's local time (New York vs Los Angeles)", () => {
    const essay = task({ estimateMinutes: 60, dueDate: TUE })
    const exam: ExternalEventRecord = {
      id: "exam",
      source: "canvas",
      title: "Exam",
      description: null,
      // 12:00-20:00 UTC = 8 AM-4 PM New York = 5 AM-1 PM Los Angeles.
      startsAt: "2026-09-22T12:00:00Z",
      endsAt: "2026-09-22T20:00:00Z",
      location: null,
      url: null,
      hidden: false,
    }
    const ny = plannerFor({ tasks: [essay], externalEvents: [exam], timeZone: "America/New_York" }, at(TUE, "07:00")).planFor(TUE)
    expect(slots(ny)[0]).toBe("16:15-17:15")
    const la = plannerFor({ tasks: [essay], externalEvents: [exam], timeZone: "America/Los_Angeles" }, at(TUE, "07:00")).planFor(TUE)
    expect(slots(la)[0]).toBe("13:15-14:15")
  })

  it("a task due at midnight-ish (11:59 PM) is planned that day, before its due time", () => {
    const lateNight = task({ estimateMinutes: 60, dueDate: TUE, dueTime: "23:59" })
    const plan = plannerFor({ tasks: [lateNight], events: [event(TUE, "08:00", "21:00")] }, at(TUE, "07:00"), { maxShareOfFreeTime: 1 }).planFor(TUE)
    expect(slots(plan)).toEqual(["21:15-22:00"])
  })
})
