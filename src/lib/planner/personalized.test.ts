import { describe, expect, it } from "vitest"
import { toMinutes } from "@/lib/events"
import { addDays } from "@/lib/format"
import { adaptiveContextFor, plannerInputFor, type PlannerSource } from "@/lib/planner-input"
import { scheduleBetween } from "@/lib/recurring"
import {
  DEFAULT_LEARNING_SETTINGS,
  type Course,
  type ExternalEventRecord,
  type LearningSettings,
  type RecurringCommitment,
  type StudySessionRecord,
  type Task,
  type TaskType,
} from "@/lib/types"
import { dayAvailability } from "./availability"
import { createPlanner } from "./generate-plan"
import type { DailyPlan, PlannerInput } from "./types"
import { whatNow } from "./what-now"

// Personalization in the Planner (Prompt 32): pacing, preferred times, "fits the
// free time now", planning modes; and several simulated weeks of five kinds of
// student using Student OS every day. Personalization may change soft
// decisions; hard constraints never move.

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
  dueDate: addDays(TUE, 5),
  priority: "medium",
  estimateMinutes: 60,
  status: "not_started",
  ...over,
})
const settings = { dayStart: "08:00", dayEnd: "22:00", maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60, breakMinutes: 10, maxShareOfFreeTime: 1 }
const minutesOf = (plan: DailyPlan, taskId?: string) =>
  plan.suggestions.filter((s) => !taskId || s.taskId === taskId).reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)
const courses = [
  { id: "csc", code: "CSC215", name: "Databases", professor: "", description: "", color: "sky" },
  { id: "psy", code: "PSY101", name: "Psychology", professor: "", description: "", color: "violet" },
] as Course[]
const prefs = { studyStart: "08:00", studyEnd: "23:00", maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60, breakMinutes: 10 }

describe("pacing (learned workload or Light day)", () => {
  it("non-urgent work stops at the soft target; urgent work can still use the full limit; nothing is reported as a problem", () => {
    const big = task({ dueDate: addDays(TUE, 2), estimateMinutes: 300 })
    const urgent = task({ dueDate: WED, estimateMinutes: 120 })
    const pacing = { softMinutes: 120, reason: "Paced near 2h: what you usually finish on busy days" }
    const plan = createPlanner({ tasks: [big, urgent], events: [], now: at(TUE, "08:00"), settings, learned: { pacing } }).planFor(TUE)
    expect(minutesOf(plan, urgent.id)).toBe(120)
    expect(minutesOf(plan, big.id)).toBe(0)
    expect(plan.pacing).toEqual(pacing)
    expect(plan.unscheduled).toEqual([])
    // Without pacing, the same day is fuller (up to the limit).
    expect(minutesOf(createPlanner({ tasks: [big, urgent], events: [], now: at(TUE, "08:00"), settings }).planFor(TUE))).toBe(240)
  })

  it("Light day mode: about half the usual study, set by the student", () => {
    const tasks = [task({ estimateMinutes: 300, dueDate: addDays(TUE, 2) })]
    const input = plannerInputFor(
      { tasks, courses, events: [], studySessions: [], recurringCommitments: [], preferences: prefs, learning: { ...DEFAULT_LEARNING_SETTINGS, planningMode: "light-day" } },
      at(TUE, "08:00")
    )
    const plan = createPlanner(input).planFor(TUE)
    expect(minutesOf(plan)).toBeLessThanOrEqual(120)
    expect(plan.pacing?.reason).toMatch(/^Light day \(your planning mode\): about 2h of study/)
  })
})

describe("preferred times (explicit)", () => {
  it("study goes into the preferred time first; the next hour today still counts (the student is here)", () => {
    const t = task({ estimateMinutes: 300, dueDate: addDays(TUE, 4) })
    const evening = { start: 17 * 60, end: 21 * 60, reason: "In the evening: the time you said you prefer" }
    const planner = createPlanner({ tasks: [t], events: [], now: at(TUE, "08:00"), settings, learned: { preferTimes: [evening] } })
    expect(planner.planFor(TUE).suggestions[0].startTime).toBe("08:00")
    const wed = planner.planFor(WED)
    expect(wed.suggestions[0].startTime).toBe("17:00")
    expect(wed.suggestions[0].reasons).toContain(evening.reason)
  })

  it("an explicit preference beats a learned 'use last' for the same time", () => {
    const done = task({ status: "completed" })
    const history: StudySessionRecord[] = Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, taskId: done.id, date: addDays(TUE, -1 - i), startTime: "21:00", endTime: "22:00", status: "scheduled" }))
    history.push(...Array.from({ length: 8 }, (_, i): StudySessionRecord => ({ id: `a${i}`, taskId: done.id, date: addDays(TUE, -1 - i), startTime: "14:00", endTime: "15:00", status: "completed" })))
    const open = task({ dueDate: addDays(WED, 3) })
    const source = (learning: LearningSettings): PlannerSource => ({ tasks: [done, open], courses, events: [], studySessions: history, recurringCommitments: [], preferences: prefs, learning })
    const learnedOnly = plannerInputFor(source(DEFAULT_LEARNING_SETTINGS), at(TUE, "08:00"))
    expect(learnedOnly.learned?.avoidTimes?.[0]).toMatchObject({ start: 1260 })
    const preferNight = plannerInputFor(source({ ...DEFAULT_LEARNING_SETTINGS, preferredPeriods: ["night"] }), at(TUE, "08:00"))
    expect(preferNight.learned?.avoidTimes).toBeUndefined()
    expect(createPlanner(preferNight).planFor(WED).suggestions[0].startTime).toBe("21:00")
  })
})

describe("'What should I do now?' fits the free time", () => {
  it("75 free minutes: the 30-minute reading goes first, the 90-minute assignment waits for a longer block", () => {
    const programming = task({ title: "A Programming Assignment", estimateMinutes: 90, dueDate: addDays(TUE, 3) })
    const reading = task({ title: "Biology Reading", type: "reading", estimateMinutes: 30, dueDate: addDays(TUE, 3) })
    const events = [{ id: "work", title: "Work", date: TUE, startTime: "15:15", endTime: "22:00", type: "work" as const }]
    const input: PlannerInput = { tasks: [programming, reading], events, now: at(TUE, "14:00"), settings }
    const planner = createPlanner(input)
    const answer = whatNow({ planner, now: at(TUE, "14:00"), today: TUE, schedule: events, events, tasks: input.tasks })
    expect(answer.kind === "work" && answer.task.id).toBe(reading.id)
    expect(answer.kind === "work" && answer.reasons).toContain("Fits in the 1h 15m you have free now")
  })

  it("an urgent deadline still wins over a task that merely fits", () => {
    const urgent = task({ title: "Due today", estimateMinutes: 120, dueDate: TUE, priority: "high" })
    const small = task({ title: "Small", estimateMinutes: 30, dueDate: addDays(TUE, 4) })
    const events = [{ id: "work", title: "Work", date: TUE, startTime: "15:15", endTime: "22:00", type: "work" as const }]
    const planner = createPlanner({ tasks: [urgent, small], events, now: at(TUE, "14:00"), settings })
    const answer = whatNow({ planner, now: at(TUE, "14:00"), today: TUE, schedule: events, events, tasks: [urgent, small] })
    expect(answer.kind === "work" && answer.task.id).toBe(urgent.id)
  })
})

describe("planning modes", () => {
  it("Exam focus (saved mode) puts exam prep first and says why; 'My settings only' ignores learned history", () => {
    const exam = task({ type: "exam", dueDate: addDays(TUE, 6), estimateMinutes: 60 })
    const essay = task({ type: "paper", dueDate: addDays(TUE, 4), estimateMinutes: 60, priority: "high" })
    const source = (mode: LearningSettings["planningMode"]): PlannerSource => ({
      tasks: [exam, essay],
      courses,
      events: [],
      studySessions: [],
      recurringCommitments: [],
      preferences: prefs,
      learning: { ...DEFAULT_LEARNING_SETTINGS, planningMode: mode },
    })
    const balanced = createPlanner(plannerInputFor(source("balanced"), at(TUE, "08:00"))).planFor(TUE)
    const examFocus = createPlanner(plannerInputFor(source("exam-focus"), at(TUE, "08:00"))).planFor(TUE)
    expect(balanced.ranked[0].task.id).toBe(essay.id)
    expect(examFocus.ranked[0].task.id).toBe(exam.id)
    expect(examFocus.suggestions.find((s) => s.taskId === exam.id)?.reasons).toContain("Exam focus (your planning mode)")
  })
})

describe("hard constraints hold with every personalization on", () => {
  it("external calendar events, weekly commitments, the daily limit and the time zone", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => task({ dueDate: addDays(TUE, 1 + (i % 3)), estimateMinutes: 180 }))
    const commitments: RecurringCommitment[] = [{ id: "c", title: "Soccer", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "17:00", endTime: "19:00", type: "sports" }]
    // A Canvas lecture 1-2 PM in New York (stored as an instant).
    const external: ExternalEventRecord[] = [
      { id: "x", source: "canvas", title: "Lecture", description: null, startsAt: "2026-09-22T17:00:00.000Z", endsAt: "2026-09-22T18:00:00.000Z", location: null, url: null, hidden: false },
    ]
    const learning: LearningSettings = { ...DEFAULT_LEARNING_SETTINGS, planningMode: "deadline-focus", preferredPeriods: ["morning"] }
    const data: PlannerSource = { tasks, courses, events: [], studySessions: [], recurringCommitments: commitments, externalEvents: external, timeZone: "America/New_York", preferences: prefs, learning }
    const input = plannerInputFor(data, at(TUE, "08:00"))
    input.learned = { ...input.learned, pacing: { softMinutes: 90, reason: "pace" }, avoidTimes: [{ start: 8 * 60, end: 12 * 60, reason: "avoid" }], estimates: Object.fromEntries(tasks.map((t) => [t.id, { minutes: 400, reason: "learned" }])) }
    const planner = createPlanner(input)
    for (const date of [TUE, WED, addDays(TUE, 2)]) {
      const plan = planner.planFor(date)
      expectFeasible(plan, input, commitments)
      expect(plan.suggestions.some((s) => s.startTime < "14:00" && s.endTime > "13:00" && date === TUE)).toBe(false)
    }
  })
})

// Every suggestion inside real free time (not over events, weekly commitments or
// external events), inside the study window, no overlaps, within the daily limit.
function expectFeasible(plan: DailyPlan, input: PlannerInput, commitments: RecurringCommitment[]) {
  const s = input.settings!
  const day = dayAvailability(plan.date, input.events, commitments, input.now, { ...createPlanner(input).settings })
  const busy = scheduleBetween(input.events, commitments, plan.date, plan.date).filter((e) => e.type !== "study")
  const sorted = [...plan.suggestions].sort((a, b) => a.startTime.localeCompare(b.startTime))
  let total = day.bookedStudyMinutes
  for (const [i, x] of sorted.entries()) {
    const [start, end] = [toMinutes(x.startTime), toMinutes(x.endTime)]
    expect(start >= toMinutes(s.dayStart!) && end <= toMinutes(s.dayEnd!), `${plan.date} ${x.startTime} window`).toBe(true)
    expect(busy.some((e) => toMinutes(e.startTime) < end && start < toMinutes(e.endTime)), `${plan.date} ${x.startTime} busy`).toBe(false)
    if (i > 0) expect(start).toBeGreaterThanOrEqual(toMinutes(sorted[i - 1].endTime))
    total += end - start
  }
  expect(total).toBeLessThanOrEqual(s.maxStudyMinutesPerDay!)
}

// ---- Several weeks as five kinds of student ----------------------------------------

type Outcome = "done" | "missed" | "moved"
type Student = {
  // How long their tasks really take, as a multiple of their estimate.
  ratio: (day: number, rand: () => number) => number
  // What happens to a planned session at this hour on this day.
  outcome: (hour: number, day: number, rand: () => number) => Outcome
  tasksPerDay: number
  estimate: number
  commitments?: RecurringCommitment[]
}

function simulate(student: Student, days: number, seed = 1) {
  let s = seed
  const rand = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
  const start = "2026-09-01"
  const tasks: Task[] = []
  const trueMinutes = new Map<string, number>()
  const sessions: StudySessionRecord[] = []
  const log: { day: number; plan: DailyPlan; input: PlannerInput; source: PlannerSource }[] = []
  const types: TaskType[] = ["assignment", "reading", "lab", "paper"]
  let sid = 0
  for (let day = 0; day < days; day++) {
    const date = addDays(start, day)
    for (let k = 0; k < student.tasksPerDay; k++) {
      const t = task({ dueDate: addDays(date, 4), estimateMinutes: student.estimate, courseId: k % 2 ? "psy" : "csc", type: types[(day + k) % 4] })
      tasks.push(t)
      trueMinutes.set(t.id, Math.round(student.estimate * student.ratio(day, rand)))
    }
    const source: PlannerSource = { tasks: [...tasks], courses, events: [], studySessions: [...sessions], recurringCommitments: student.commitments ?? [], preferences: prefs, learning: DEFAULT_LEARNING_SETTINGS }
    const now = at(date, "07:00")
    const input = plannerInputFor(source, now, adaptiveContextFor(source, now))
    const plan = createPlanner(input).planFor(date)
    log.push({ day, plan, input, source })
    for (const x of plan.suggestions) {
      const outcome = student.outcome(Number(x.startTime.slice(0, 2)), day, rand)
      const base = { id: `sim-${++sid}`, taskId: x.taskId, date, startTime: x.startTime, endTime: x.endTime }
      if (outcome === "done") sessions.push({ ...base, status: "completed" })
      else if (outcome === "missed") sessions.push({ ...base, status: "scheduled" })
      else sessions.push({ ...base, startTime: "13:00", endTime: `13:${String(Math.min(59, toMinutes(x.endTime) - toMinutes(x.startTime))).padStart(2, "0")}`, status: "completed", rescheduleCount: 1, firstDate: date, firstStartTime: x.startTime })
    }
    // At the end of the day: a task whose real work is done is marked complete;
    // work the Planner didn't plan (it expected less) is logged as done too.
    for (const t of tasks) {
      if (t.status === "completed") continue
      const worked = sessions.filter((x) => x.taskId === t.id && x.status === "completed").reduce((sum, x) => sum + toMinutes(x.endTime) - toMinutes(x.startTime), 0)
      const need = trueMinutes.get(t.id)!
      const plannerThinks = createPlanner(input).estimateOf(t).minutes
      if (worked >= plannerThinks && worked < need) {
        const extra = Math.min(need - worked, 180)
        // Logged early the next morning (before the study window), so it never overlaps the plan.
        const end = 5 * 60 + extra
        sessions.push({ id: `sim-${++sid}`, taskId: t.id, date, startTime: "05:00", endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`, status: "completed" })
      }
      const total = sessions.filter((x) => x.taskId === t.id && x.status === "completed").reduce((sum, x) => sum + toMinutes(x.endTime) - toMinutes(x.startTime), 0)
      if (total >= Math.min(need, plannerThinks) && (total >= need || t.dueDate <= date)) t.status = "completed"
    }
  }
  return { log, tasks, sessions, trueMinutes }
}

const always = (): Outcome => "done"

describe("several weeks of real use (five kinds of student)", () => {
  it("Student A (new): plans normally from day one, with nothing learned", () => {
    const { log } = simulate({ ratio: () => 1, outcome: always, tasksPerDay: 1, estimate: 60 }, 1)
    expect(log[0].plan.suggestions.length).toBeGreaterThan(0)
    expect(log[0].input.learned).toBeUndefined()
  })

  it("Student B (consistent: tasks take 1.5×, late nights get missed): estimates and times get better", () => {
    const b: Student = { ratio: () => 1.5, outcome: (hour) => (hour >= 21 ? "missed" : "done"), tasksPerDay: 2, estimate: 60, commitments: [{ id: "class", title: "Classes and work", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startTime: "08:00", endTime: "19:00", type: "class" }] }
    const { log, tasks } = simulate(b, 35)
    for (const { plan, input } of log) expectFeasible(plan, input, b.commitments!)
    const last = log.at(-1)!
    const open = tasks.find((t) => t.status !== "completed")!
    const planner = createPlanner(last.input)
    // The Planner now expects about 1.4-1.5× the student's estimate, and says why.
    expect(planner.estimateOf(open).minutes).toBeGreaterThanOrEqual(80)
    expect(planner.estimateOf(open).learned?.reason).toMatch(/^Adjusted to 1h (2|3)\dm from your past/)
    // Late night is now used last: only when the evening (19:00-21:00) is already full.
    expect(last.input.learned?.avoidTimes?.map((a) => a.start)).toContain(21 * 60)
    for (const { plan } of log.slice(-7)) {
      const late = plan.suggestions.filter((x) => toMinutes(x.startTime) >= 21 * 60)
      if (late.length === 0) continue
      const evening = plan.suggestions.filter((x) => toMinutes(x.startTime) < 21 * 60).reduce((sum, x) => sum + toMinutes(x.endTime) - toMinutes(x.startTime), 0)
      // The evening has 1h 45m (after the 15-minute buffer); a 90-minute session and a break leave no usable block.
      expect(evening, plan.date).toBeGreaterThanOrEqual(90)
    }
  })

  it("Student C (unpredictable): no strong conclusions, and every plan stays feasible", () => {
    const c: Student = { ratio: (_, rand) => 0.5 + rand() * 1.5, outcome: (_, __, rand) => (rand() < 0.5 ? "done" : rand() < 0.5 ? "missed" : "moved"), tasksPerDay: 1, estimate: 60 }
    const { log, tasks } = simulate(c, 30, 42)
    for (const { plan, input } of log) expectFeasible(plan, input, [])
    const last = log.at(-1)!
    expect(last.input.learned?.avoidTimes ?? []).toEqual([])
    const open = tasks.find((t) => t.status !== "completed")
    if (open) expect(Math.abs(createPlanner(last.input).estimateOf(open).minutes - 60)).toBeLessThanOrEqual(20)
  })

  it("Student D (heavy workload, busy days): personalization never makes a plan impossible", () => {
    const d: Student = {
      ratio: () => 1.3,
      outcome: (hour) => (hour < 10 ? "missed" : "done"),
      tasksPerDay: 3,
      estimate: 120,
      commitments: [
        { id: "work", title: "Work", daysOfWeek: [1, 3, 5], startTime: "12:00", endTime: "18:00", type: "work" },
        { id: "class", title: "Class", daysOfWeek: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "11:00", type: "class" },
      ],
    }
    const { log } = simulate(d, 28, 3)
    for (const { plan, input } of log) expectFeasible(plan, input, d.commitments!)
    expect(log.every((l) => l.plan.status !== "no-time" || l.plan.suggestions.length === 0)).toBe(true)
  })

  it("Student E (changing habits): mornings early in the semester, afternoons later; the Planner follows the recent habit", () => {
    const e: Student = {
      ratio: () => 1,
      // Weeks 1-4: mornings work, afternoons don't. Then the other way round.
      outcome: (hour, day) => (day < 28 ? (hour < 12 ? "done" : hour < 17 ? "missed" : "done") : hour < 12 ? "missed" : "done"),
      tasksPerDay: 2,
      estimate: 60,
    }
    const { log } = simulate(e, 70, 5)
    const avoidedAt = (day: number) => (log[day].input.learned?.avoidTimes ?? []).map((a) => a.start)
    const morningShare = (days: typeof log) => {
      const all = days.flatMap((d) => d.plan.suggestions)
      return all.filter((x) => toMinutes(x.startTime) < 12 * 60).length / Math.max(1, all.length)
    }
    // Early on, mornings work: they're used.
    expect(avoidedAt(27)).not.toContain(5 * 60)
    expect(morningShare(log.slice(20, 28))).toBeGreaterThan(0.5)
    // Weeks later, the new habit wins over the old one: mornings are used last.
    expect(avoidedAt(69)).toContain(5 * 60)
    expect(morningShare(log.slice(-7))).toBeLessThan(0.2)
  })
})
