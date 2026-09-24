import { describe, expect, it } from "vitest"
import { addDays } from "@/lib/format"
import { adaptiveContextFor } from "@/lib/planner-input"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { DEFAULT_LEARNING_SETTINGS, type Course, type LearningSettings, type StudySessionRecord, type Task, type TaskType } from "@/lib/types"
import { analyzeHistory, learnedPlanning, type BehaviorHistory } from "./index"

// Long-term personalization (Prompt 32), pure: the StudentPlanningProfile,
// recency, confidence, the student's controls, and graceful failure.

const TODAY = "2026-11-20"
const courses = [
  { id: "csc", code: "CSC215", name: "Databases", professor: "", description: "", color: "sky" },
  { id: "psy", code: "PSY101", name: "Psychology", professor: "", description: "", color: "violet" },
] as Course[]
let n = 0
const task = (over: Partial<Task> = {}): Task =>
  ({ id: `t${++n}`, courseId: "csc", title: `Task ${n}`, description: "", type: "assignment", dueDate: addDays(TODAY, 5), priority: "medium", estimateMinutes: 60, status: "not_started", ...over }) as Task
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
const session = (taskId: string, date: string, start: string, minutes: number, over: Partial<StudySessionRecord> = {}): StudySessionRecord => {
  const [h, m] = start.split(":").map(Number)
  return { id: `s${++n}`, taskId, date, startTime: start, endTime: hhmm(h * 60 + m + minutes), status: "completed", ...over }
}
const settings = (over: Partial<LearningSettings> = {}): LearningSettings => ({ ...DEFAULT_LEARNING_SETTINGS, ...over })
const analyze = (h: Omit<BehaviorHistory, "courses"> & { courses?: Course[] }) => analyzeHistory({ courses, dailyLimitMinutes: 240, ...h }, TODAY)

// A student who finishes tasks at `ratio` × their estimate, logged in the afternoon.
function finishedTasks(count: number, ratio: number, over: Partial<Task> = {}, daysAgo = (i: number) => 2 + i) {
  const tasks: Task[] = []
  const sessions: StudySessionRecord[] = []
  for (let i = 0; i < count; i++) {
    const t = task({ status: "completed", ...over })
    tasks.push(t)
    sessions.push(session(t.id, addDays(TODAY, -daysAgo(i)), "15:00", Math.round((t.estimateMinutes ?? 60) * ratio)))
  }
  return { tasks, sessions }
}
// Sessions at a time of day with an outcome, one per day, `from` days ago backwards.
function habit(time: string, count: number, status: StudySessionRecord["status"], from = 1) {
  const t = task({ status: "in_progress", estimateMinutes: 6000 })
  return { tasks: [t], sessions: Array.from({ length: count }, (_, i) => session(t.id, addDays(TODAY, -(from + i)), time, 60, { status })) }
}
type Part = { tasks: Task[]; sessions?: StudySessionRecord[]; studySessions?: StudySessionRecord[] }
const merge = (...parts: Part[]) => ({ tasks: parts.flatMap((p) => p.tasks), studySessions: parts.flatMap((p) => p.sessions ?? p.studySessions ?? []) })

describe("the StudentPlanningProfile", () => {
  it("cold start: only the student's explicit choices; nothing observed or inferred", () => {
    const context = analyze({ tasks: [task()], studySessions: [], learning: settings({ planningMode: "exam-focus", preferredPeriods: ["evening"] }) })
    expect(context.profile).toEqual({
      asOf: TODAY,
      learning: "on",
      explicit: { planningMode: "exam-focus", preferredPeriods: ["evening"], tasksUsingOwnEstimate: 0, turnedOffPatterns: 0 },
      observed: { estimatesByKind: [] },
      inferred: [],
    })
  })

  it("sparse history: values without enough evidence are simply absent", () => {
    const data = merge(finishedTasks(3, 1.5), habit("15:00", 2, "completed"))
    const o = analyze({ ...data, learning: settings() }).profile.observed
    expect(o.sessionCompletionRate).toBeUndefined()
    expect(o.estimateAccuracy).toBeUndefined()
    expect(o.bestStudyTime).toBeUndefined()
  })

  it("a long, consistent history: each value has confidence, observations, newest evidence and a source", () => {
    const data = merge(finishedTasks(14, 1.5, { type: "lab" }), habit("15:00", 20, "completed"), habit("21:30", 8, "scheduled"))
    const { profile } = analyze({ ...data, learning: settings() })
    expect(profile.observed.estimateAccuracy).toMatchObject({ value: 1.5, confidence: "high", observations: 14, updatedAt: addDays(TODAY, -2), source: "Finished tasks with logged study time" })
    expect(profile.observed.estimatesByKind.map((e) => e.value)).toEqual([
      { label: "CSC215 lab reports", ratio: 1.5 },
      { label: "lab reports", ratio: 1.5 },
    ])
    expect(profile.observed.bestStudyTime).toMatchObject({ value: "afternoon", explanation: expect.stringMatching(/afternoon \(\d+ of \d+ recently\)/) })
    expect(profile.observed.oftenMissedTimes).toMatchObject({ value: ["late night"] })
    expect(profile.observed.sessionCompletionRate?.value).toBeGreaterThan(0.7)
    expect(profile.observed.typicalSessionMinutes?.value).toBeGreaterThan(0)
    // What the Planner does with it is separate from what was observed.
    expect(profile.inferred.map((i) => i.text)).toContain("Not in the late night: you often miss or move sessions then, so the Planner uses other free time first.")
  })

  it("inconsistent history stays low confidence", () => {
    const ratios = [0.5, 2, 0.8, 1.9, 0.6, 1.7, 1, 2.2, 0.7]
    const parts = ratios.map((r) => finishedTasks(1, r))
    const { profile, estimates } = analyze({ ...merge(...parts), learning: settings() })
    expect(profile.observed.estimateAccuracy?.confidence).toBe("low")
    const open = task()
    expect(analyze({ tasks: [...merge(...parts).tasks, open], studySessions: merge(...parts).studySessions, learning: settings() }).estimates[open.id]?.confidence ?? "low").toBe("low")
    expect(estimates).toEqual({})
  })

  it("course-specific and task-type patterns are separate", () => {
    const cs = finishedTasks(6, 1.6, { courseId: "csc", type: "assignment" })
    const psy = finishedTasks(6, 0.6, { courseId: "psy", type: "reading" })
    const csOpen = task({ courseId: "csc" })
    const psyOpen = task({ courseId: "psy", type: "reading" })
    const context = analyze({ tasks: [...cs.tasks, ...psy.tasks, csOpen, psyOpen], studySessions: [...cs.sessions, ...psy.sessions], learning: settings() })
    expect(context.estimates[csOpen.id].minutes).toBeGreaterThan(60)
    expect(context.estimates[psyOpen.id].minutes).toBeLessThan(60)
    expect(context.insights.filter((i) => i.kind === "estimate").map((i) => i.text)).toEqual([
      "CSC215 assignments usually take you longer than you estimate (about 1.6×, from 6 tasks).",
      "PSY101 readings usually take you less time than you estimate (about 0.6×, from 6 tasks).",
    ])
  })
})

describe("no over-generalizing", () => {
  it("one kind of history (CSC215 labs) says nothing about a Psychology exam", () => {
    const labs = finishedTasks(10, 1.5, { courseId: "csc", type: "lab" })
    const exam = task({ courseId: "psy", type: "exam", estimateMinutes: 120 })
    const context = analyze({ tasks: [...labs.tasks, exam], studySessions: labs.sessions, learning: settings() })
    expect(context.estimates[exam.id]).toBeUndefined()
  })

  it("…but history across several kinds of task can inform a new kind", () => {
    const mixed = [
      finishedTasks(3, 1.5, { courseId: "csc", type: "lab" }),
      finishedTasks(3, 1.5, { courseId: "csc", type: "assignment" }),
      finishedTasks(3, 1.5, { courseId: "psy", type: "reading" }),
    ]
    const exam = task({ courseId: "bio", type: "exam", estimateMinutes: 120 })
    const context = analyze({ tasks: [...mixed.flatMap((m) => m.tasks), exam], studySessions: mixed.flatMap((m) => m.sessions), learning: settings() })
    expect(context.estimates[exam.id]?.basis.group).toBe("all")
  })
})

describe("recency and changing habits", () => {
  it("Student E: mornings early in the semester, afternoons now: the recent habit wins", () => {
    // Early semester (about 2.5 months ago) vs the last two weeks.
    const early = merge(habit("08:00", 12, "completed", 75), habit("15:00", 12, "scheduled", 75))
    const now = merge(habit("08:00", 12, "scheduled", 1), habit("15:00", 12, "completed", 1))
    const context = analyze({ ...merge(early, now), learning: settings() })
    expect(context.avoid.map((a) => a.period)).toEqual(["morning"])
    expect(context.profile.observed.bestStudyTime?.value).toBe("afternoon")
  })

  it("history older than 90 days doesn't decide today's times", () => {
    const old = merge(habit("08:00", 12, "scheduled", 100), habit("15:00", 12, "completed", 100))
    expect(analyze({ ...old, learning: settings() }).avoid).toEqual([])
  })

  it("a couple of bad days don't flip a solid habit (smoothing)", () => {
    const solid = merge(habit("18:00", 14, "completed", 5), habit("15:00", 10, "completed", 5))
    const blip = habit("18:00", 3, "scheduled", 1)
    expect(analyze({ ...merge(solid, blip), learning: settings() }).avoid).toEqual([])
  })

  it("Student C: unpredictable (random outcomes and durations) never overfits", () => {
    let seed = 7
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
    const tasks: Task[] = []
    const sessions: StudySessionRecord[] = []
    for (let i = 0; i < 40; i++) {
      const t = task({ status: "completed" })
      tasks.push(t)
      const time = ["08:00", "12:30", "17:30", "21:30"][Math.floor(rand() * 4)]
      sessions.push(session(t.id, addDays(TODAY, -1 - (i % 30)), time, Math.round(60 * (0.4 + rand() * 1.8)), { status: rand() < 0.5 ? "completed" : "scheduled" }))
    }
    const open = task()
    const context = analyze({ tasks: [...tasks, open], studySessions: sessions, learning: settings() })
    expect(context.avoid).toEqual([])
    const learned = context.estimates[open.id]
    // Noise may still show a mild tendency, but never a big change.
    if (learned) expect(Math.abs(learned.minutes - 60)).toBeLessThanOrEqual(15)
  })
})

describe("the student's controls", () => {
  const history = () => {
    const d = merge(finishedTasks(8, 1.5), habit("21:30", 8, "scheduled"), habit("15:00", 10, "completed"))
    // 10 days planning 4h and finishing 2h.
    const heavy = task({ status: "completed" })
    // (Days 11-20: nothing else on those days.)
    for (let i = 11; i <= 20; i++) d.studySessions.push(session(heavy.id, addDays(TODAY, -i), "09:00", 120), session(heavy.id, addDays(TODAY, -i), "13:00", 120, { status: "scheduled" }))
    d.tasks.push(heavy)
    const open = task()
    d.tasks.push(open)
    return { ...d, open }
  }

  it("everything on: learned durations, times used last and a pace", () => {
    const h = history()
    const context = analyze({ ...h, learning: settings() })
    expect(context.estimates[h.open.id]).toBeDefined()
    expect(context.avoid.map((a) => a.period)).toEqual(["night"])
    expect(context.pacing).toMatchObject({ softMinutes: 120 })
    expect(learnedPlanning(context)).toMatchObject({ estimates: expect.any(Object), avoidTimes: [expect.any(Object)], pacing: { softMinutes: 120 } })
  })

  it("each learned signal can be switched off on its own", () => {
    const h = history()
    expect(analyze({ ...h, learning: settings({ useEstimates: false }) }).estimates).toEqual({})
    expect(analyze({ ...h, learning: settings({ useStudyTimes: false }) }).avoid).toEqual([])
    expect(analyze({ ...h, learning: settings({ useWorkload: false }) }).pacing).toBeNull()
    // Switched off, it's still shown (observed), just not used.
    expect(analyze({ ...h, learning: settings({ useStudyTimes: false }) }).insights.find((i) => i.id === "avoid:night")).toMatchObject({ affectsPlanning: false })
  })

  it("'Don't use this pattern': that one pattern stops, the rest stays", () => {
    const h = history()
    const context = analyze({ ...h, learning: settings({ dismissedPatterns: ["avoid:night", "workload", "estimate:t:assignment"] }) })
    expect(context.avoid).toEqual([])
    expect(context.pacing).toBeNull()
    expect(context.estimates[h.open.id]).toBeUndefined()
    expect(context.insights.find((i) => i.id === "avoid:night")).toMatchObject({ dismissed: true })
  })

  it("'This estimate is wrong': the student's own estimate for that task", () => {
    const h = history()
    expect(analyze({ ...h, learning: settings({ ownEstimateTaskIds: [h.open.id] }) }).estimates[h.open.id]).toBeUndefined()
  })

  it("'I actually prefer studying at night': explicit beats learned, and applies even with learning off", () => {
    const h = history()
    const context = analyze({ ...h, learning: settings({ preferredPeriods: ["night"] }) })
    expect(context.avoid).toEqual([])
    expect(context.insights.find((i) => i.id === "avoid:night")?.text).toMatch(/you said you prefer the late night, so the Planner keeps using it/)
    expect(learnedPlanning(context)?.preferTimes).toEqual([{ start: 1260, end: 1440, reason: "In the late night: the time you said you prefer" }])
    const off = analyze({ ...h, learning: settings({ enabled: false, preferredPeriods: ["night"] }) })
    expect(learnedPlanning(off)).toEqual({ preferTimes: [expect.objectContaining({ start: 1260 })] })
  })

  it("'My settings only' (custom): nothing learned is used, explicit choices are", () => {
    const h = history()
    const context = analyze({ ...h, learning: settings({ planningMode: "custom", preferredPeriods: ["afternoon"] }) })
    expect(context).toMatchObject({ estimates: {}, avoid: [], pacing: null })
    expect(context.profile.learning).toBe("custom")
    expect(learnedPlanning(context)).toEqual({ preferTimes: [expect.objectContaining({ start: 720 })] })
  })

  it("pacing never reaches the student's own limit", () => {
    const h = history()
    expect(analyzeHistory({ ...h, courses, learning: settings(), dailyLimitMinutes: 120 }, TODAY).pacing).toBeNull()
  })
})

describe("never breaks planning", () => {
  it("corrupt history is ignored, not trusted", () => {
    const t = task({ status: "completed", estimateMinutes: Number.NaN })
    const bad: StudySessionRecord[] = [
      { id: "a", taskId: t.id, date: "not-a-date", startTime: "15:00", endTime: "16:00", status: "completed" },
      { id: "b", taskId: t.id, date: addDays(TODAY, -1), startTime: "25:00", endTime: "16:00", status: "completed" },
      { id: "c", taskId: t.id, date: addDays(TODAY, -1), startTime: "16:00", endTime: "15:00", status: "completed" },
      { id: "d", taskId: "deleted-task", date: addDays(TODAY, -1), startTime: "15:00", endTime: "16:00", status: "completed" },
      { id: "e", taskId: t.id, date: addDays(TODAY, -1), startTime: "15:00", endTime: "16:00", status: "completed", completedMinutes: -30 },
    ]
    const context = analyze({ tasks: [t], studySessions: bad, learning: settings() })
    expect(context).toMatchObject({ observations: 0, estimates: {}, avoid: [] })
  })

  it("if the analysis fails, planning goes on without it", () => {
    const data = { tasks: [task()], courses, events: [], studySessions: null as unknown as StudySessionRecord[], recurringCommitments: [], preferences: DEFAULT_STUDENT_PREFERENCES, learning: settings() }
    expect(adaptiveContextFor(data, new Date(2026, 10, 20, 9, 0))).toBeUndefined()
  })

  it("a whole semester of history is fast", () => {
    const tasks: Task[] = []
    const sessions: StudySessionRecord[] = []
    const types: TaskType[] = ["assignment", "reading", "lab", "paper", "project"]
    for (let i = 0; i < 400; i++) {
      const t = task({ status: i % 5 === 0 ? "not_started" : "completed", type: types[i % 5], courseId: i % 2 ? "csc" : "psy" })
      tasks.push(t)
      for (let j = 0; j < 5; j++) sessions.push(session(t.id, addDays(TODAY, -1 - ((i + j) % 120)), ["09:00", "14:00", "18:00", "21:30"][(i + j) % 4], 45))
    }
    const started = performance.now()
    const context = analyze({ tasks, studySessions: sessions, learning: settings() })
    expect(performance.now() - started).toBeLessThan(250)
    expect(context.observations).toBeGreaterThan(300)
  })
})
