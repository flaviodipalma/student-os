import { describe, expect, it } from "vitest"
import { addDays } from "@/lib/format"
import type { Course, StudySessionRecord, Task, TaskType } from "@/lib/types"
import { ADAPTIVE_RULES, analyzeHistory, confidenceOf, learnedPlanning, periodOf, type BehaviorHistory } from "./index"
import { robustSummary } from "./stats"

// Adaptive planning, pure: fixed "today", hand-built history. Every number the
// student could be told comes out of these functions.

const TODAY = "2026-09-24"
const courses: Course[] = [
  { id: "csc", code: "CSC215", name: "Database Systems", professor: "", description: "", color: "sky" },
  { id: "psy", code: "PSY101", name: "Intro to Psychology", professor: "", description: "", color: "violet" },
] as Course[]

let n = 0
const task = (over: Partial<Task> = {}): Task =>
  ({
    id: `t${++n}`,
    courseId: "csc",
    title: `Task ${n}`,
    description: "",
    type: "assignment",
    dueDate: addDays(TODAY, 5),
    priority: "medium",
    estimateMinutes: 60,
    status: "not_started",
    ...over,
  }) as Task
const session = (taskId: string, date: string, startTime: string, minutes: number, over: Partial<StudySessionRecord> = {}): StudySessionRecord => {
  const [h, m] = startTime.split(":").map(Number)
  const end = h * 60 + m + minutes
  return {
    id: `s${++n}`,
    taskId,
    date,
    startTime,
    endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}`,
    status: "completed",
    ...over,
  }
}

// A finished task that took `actual` minutes (logged as one completed session `daysAgo` days ago).
function finished(actual: number, over: Partial<Task> = {}, daysAgo = 3) {
  const t = task({ status: "completed", ...over })
  return { task: t, sessions: [session(t.id, addDays(TODAY, -daysAgo), "15:00", actual)] }
}
function history(items: { task: Task; sessions: StudySessionRecord[] }[], extra: Partial<BehaviorHistory> = {}): BehaviorHistory {
  return { tasks: items.map((i) => i.task), courses, studySessions: items.flatMap((i) => i.sessions), learning: { enabled: true, since: null }, ...extra }
}
const open = (over: Partial<Task> = {}) => ({ task: task(over), sessions: [] })

describe("cold start and sparse data", () => {
  it("a brand-new student: nothing learned, the Planner gets nothing, no insights", () => {
    const target = open()
    const context = analyzeHistory(history([target]), TODAY)
    expect(context).toMatchObject({ enabled: true, estimates: {}, avoid: [], workload: null, observations: 0, insights: [] })
    expect(learnedPlanning(context)).toBeUndefined()
  })

  it("one (or two) finished tasks: never enough to change an estimate", () => {
    for (const count of [1, 2]) {
      const past = Array.from({ length: count }, () => finished(120))
      const target = open()
      expect(analyzeHistory(history([...past, target]), TODAY).estimates).toEqual({})
    }
  })

  it("three similar tasks: a small, low-confidence adjustment, said as 'still learning'", () => {
    const past = [finished(90), finished(95), finished(100)]
    const target = open()
    const learned = analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id]
    // Typical 1.58× shrunk by 3/(3+3): about 1.29× -> 75 minutes, not 95.
    expect(learned).toMatchObject({ userMinutes: 60, minutes: 75, confidence: "low" })
    expect(learned.basis).toMatchObject({ group: "course-type", tasks: 3, typicalRatio: 1.6 })
    expect(learned.reason).toBe("Adjusted a little from your past CSC215 assignments (still learning your pattern)")
    expect(learned.explanation).toContain("Your last 3 CSC215 assignments took about 1.6× your estimates")
  })

  it("the original estimate is kept: the task isn't changed", () => {
    const past = [finished(90), finished(95), finished(100)]
    const target = open()
    const before = structuredClone(target.task)
    analyzeHistory(history([...past, target]), TODAY)
    expect(target.task).toEqual(before)
  })
})

describe("reliable history", () => {
  it("12 consistent tasks: high confidence, a bigger (but capped) adjustment", () => {
    const past = Array.from({ length: 12 }, (_, i) => finished(85 + (i % 3) * 5))
    const target = open()
    const learned = analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id]
    expect(learned.confidence).toBe("high")
    // Typical 1.5× shrunk by 12/15 = 1.4× -> 85 minutes.
    expect(learned.minutes).toBe(85)
    expect(learned.reason).toBe("Adjusted to 1h 25m from your past CSC215 assignments")
  })

  it("5 consistent tasks: medium confidence", () => {
    const past = Array.from({ length: 5 }, () => finished(90))
    const target = open()
    expect(analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id].confidence).toBe("medium")
  })

  it("an extreme outlier (one 240-minute task among 60-75) is left out", () => {
    const past = [finished(60), finished(65), finished(70), finished(75), finished(65), finished(240)]
    const target = open()
    const learned = analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id]
    // Without the outlier the typical ratio is ~1.1: too small to change anything.
    expect(learned).toBeUndefined()
    const summary = robustSummary([60, 65, 70, 75, 65, 240].map((v) => ({ value: v / 60, weight: 1 })))
    expect(summary.kept).toHaveLength(5)
  })

  it("caps: never more than 1.8× or less than 0.6× the student's estimate", () => {
    const slow = Array.from({ length: 20 }, () => finished(400))
    const fast = Array.from({ length: 20 }, () => finished(16, { courseId: "psy", type: "reading" }))
    const a = open()
    const b = open({ courseId: "psy", type: "reading" })
    const learned = analyzeHistory(history([...slow, ...fast, a, b]), TODAY).estimates
    expect(learned[a.task.id].minutes).toBe(Math.round((60 * ADAPTIVE_RULES.maxFactor) / 5) * 5)
    expect(learned[b.task.id].minutes).toBe(Math.round((60 * ADAPTIVE_RULES.minFactor) / 5) * 5)
  })

  it("inconsistent history stays low confidence", () => {
    const past = [finished(40), finished(90), finished(150), finished(70), finished(120), finished(30), finished(100)]
    const target = open()
    const learned = analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id]
    expect(learned?.confidence ?? "low").toBe("low")
  })

  it("changing behavior: recent tasks count more than old ones", () => {
    const old = Array.from({ length: 6 }, () => finished(120, {}, 300))
    const recent = Array.from({ length: 4 }, () => finished(60, {}, 5))
    const target = open()
    const learned = analyzeHistory(history([...old, ...recent, target]), TODAY).estimates[target.task.id]
    // Recent tasks match the estimate, and they outweigh the older, slower ones.
    expect(learned).toBeUndefined()
  })

  it("logged work far below the estimate (probably not all logged) isn't used as a ratio", () => {
    const past = Array.from({ length: 6 }, () => finished(10 + 15, { estimateMinutes: 240 }))
    const target = open({ estimateMinutes: 240 })
    expect(analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id]).toBeUndefined()
  })
})

describe("evidence hierarchy: course + type, course, type, all", () => {
  it("uses the most specific group with enough history", () => {
    const cscLabs = Array.from({ length: 3 }, () => finished(120, { type: "lab" }))
    const psyReadings = Array.from({ length: 3 }, () => finished(30, { courseId: "psy", type: "reading" }))
    const lab = open({ type: "lab" })
    const reading = open({ courseId: "psy", type: "reading" })
    const learned = analyzeHistory(history([...cscLabs, ...psyReadings, lab, reading]), TODAY).estimates
    expect(learned[lab.task.id].basis).toMatchObject({ group: "course-type", label: "CSC215 lab reports" })
    expect(learned[lab.task.id].minutes).toBeGreaterThan(60)
    expect(learned[reading.task.id].basis).toMatchObject({ group: "course-type", label: "PSY101 readings" })
    expect(learned[reading.task.id].minutes).toBeLessThan(60)
  })

  it("falls back to the course, then the type, then everything", () => {
    const cscMixed = [finished(120, { type: "lab" }), finished(120, { type: "paper" }), finished(120, { type: "project" })]
    const presentation = open({ type: "presentation" })
    expect(analyzeHistory(history([...cscMixed, presentation]), TODAY).estimates[presentation.task.id].basis.group).toBe("course")

    const papers = [finished(120, { type: "paper" }), finished(120, { type: "paper", courseId: "psy" }), finished(120, { type: "paper", courseId: "x" })]
    const newCoursePaper = open({ type: "paper", courseId: "y" })
    expect(analyzeHistory(history([...papers, newCoursePaper]), TODAY).estimates[newCoursePaper.task.id].basis.group).toBe("type")

    const mixed = ["lab", "paper", "project", "reading", "quiz"].map((type, i) => finished(120, { type: type as TaskType, courseId: `c${i}` }))
    const other = open({ type: "other", courseId: "z" })
    expect(analyzeHistory(history([...mixed, other]), TODAY).estimates[other.task.id].basis.group).toBe("all")
  })

  it("a task without an estimate gets what similar tasks actually took, instead of the fallback", () => {
    const past = Array.from({ length: 5 }, () => finished(100, { type: "lab" }))
    const target = open({ type: "lab", estimateMinutes: null })
    const learned = analyzeHistory(history([...past, target], { fallbackEstimateMinutes: 60 }), TODAY).estimates[target.task.id]
    // 60 + (100 − 60) × 5/8 = 85.
    expect(learned).toMatchObject({ userMinutes: null, minutes: 85 })
    expect(learned.reason).toBe("No estimate: planned as 1h 25m from your past CSC215 lab reports")
  })
})

describe("confidence", () => {
  it("depends on how many, how consistent and how recent", () => {
    expect(confidenceOf(3, 0.05, 1)).toBe("low")
    expect(confidenceOf(5, 0.1, 1)).toBe("medium")
    expect(confidenceOf(5, 0.5, 1)).toBe("low")
    expect(confidenceOf(20, 0.1, 1)).toBe("high")
    expect(confidenceOf(20, 0.2, 1)).toBe("medium")
    expect(confidenceOf(20, 0.3, 1)).toBe("low")
    // Only old history: one level less sure.
    expect(confidenceOf(20, 0.1, 400)).toBe("medium")
  })
})

describe("times of day", () => {
  const day = (i: number) => addDays(TODAY, -1 - i)
  function sessions(time: string, count: number, status: StudySessionRecord["status"]) {
    const t = task()
    return Array.from({ length: count }, (_, i) => session(t.id, day(i), time, 60, { status }))
  }

  it("often-missed late-night sessions are used last; the afternoon is where work gets done", () => {
    const s = [...sessions("22:00", 5, "scheduled"), ...sessions("21:30", 2, "completed"), ...sessions("15:00", 9, "completed"), ...sessions("16:00", 1, "skipped")]
    const context = analyzeHistory({ tasks: [], courses, studySessions: s, learning: { enabled: true, since: null } }, TODAY)
    const night = context.periods.find((p) => p.period === "night")!
    expect(night).toMatchObject({ sessions: 7, completed: 2, missed: 5 })
    expect(context.avoid).toEqual([{ period: "night", start: 21 * 60, end: 24 * 60, reason: "Not in the late night: you often miss or move sessions then", confidence: "low" }])
    expect(context.insights.filter((i) => i.kind === "time-of-day").map((i) => i.text)).toEqual([
      "You finish most study sessions in the afternoon (9 of 10).",
      "Late night sessions are often missed or moved (5 of 7), so the Planner uses other free time first when it can.",
    ])
    expect(learnedPlanning(context)?.avoidTimes).toEqual([{ start: 1260, end: 1440, reason: "Not in the late night: you often miss or move sessions then" }])
  })

  it("moved sessions count against where they were first planned", () => {
    const t = task()
    const moved = Array.from({ length: 6 }, (_, i) => session(t.id, day(i), "15:00", 60, { rescheduleCount: 1, firstDate: day(i), firstStartTime: "08:00" }))
    const context = analyzeHistory({ tasks: [t], courses, studySessions: [...moved, ...sessions("09:00", 1, "completed")], learning: { enabled: true, since: null } }, TODAY)
    expect(context.periods.find((p) => p.period === "morning")).toMatchObject({ moved: 6, completed: 1, sessions: 7 })
    expect(context.avoid.map((a) => a.period)).toEqual(["morning"])
  })

  it("not enough sessions, or no better time: nothing is avoided", () => {
    const few = analyzeHistory({ tasks: [], courses, studySessions: sessions("22:00", 4, "scheduled"), learning: { enabled: true, since: null } }, TODAY)
    expect(few.avoid).toEqual([])
    const allBad = analyzeHistory({ tasks: [], courses, studySessions: [...sessions("22:00", 6, "scheduled"), ...sessions("15:00", 6, "scheduled")], learning: { enabled: true, since: null } }, TODAY)
    expect(allBad.avoid).toEqual([])
  })

  it("periods by start time", () => {
    expect([periodOf("06:00"), periodOf("12:00"), periodOf("16:59"), periodOf("17:00"), periodOf("21:00"), periodOf("02:00")]).toEqual([
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "night",
      "night",
    ])
  })
})

describe("workload tolerance: an insight, never a changed limit", () => {
  it("on days with 4h planned, about 2h 30m gets done", () => {
    const t = task()
    const s = Array.from({ length: 6 }, (_, i) => [
      session(t.id, addDays(TODAY, -1 - i), "14:00", 150),
      session(t.id, addDays(TODAY, -1 - i), "17:00", 90, { status: "scheduled" }),
    ]).flat()
    const context = analyzeHistory({ tasks: [t], courses, studySessions: s, learning: { enabled: true, since: null } }, TODAY)
    expect(context.workload).toEqual({ days: 6, typicalPlannedMinutes: 240, typicalCompletedMinutes: 150 })
    expect(context.insights.find((i) => i.kind === "workload")?.text).toBe(
      "On days with study on your calendar, you usually finish about 2h 30m of 4h planned. Your daily limit is yours to change in Settings."
    )
    // Nothing for the Planner: the limit stays the student's.
    expect(JSON.stringify(learnedPlanning(context) ?? {})).not.toContain("limit")
  })
})

describe("user control", () => {
  const past = Array.from({ length: 5 }, () => finished(90))

  it("off: nothing is learned or used", () => {
    const target = open()
    const context = analyzeHistory(history([...past, target], { learning: { enabled: false, since: null } }), TODAY)
    expect(context).toMatchObject({ enabled: false, estimates: {}, insights: [] })
    expect(learnedPlanning(context)).toBeUndefined()
  })

  it("reset: history before the reset date doesn't count", () => {
    const target = open()
    const context = analyzeHistory(history([...past, target], { learning: { enabled: true, since: addDays(TODAY, -1) } }), TODAY)
    expect(context.estimates).toEqual({})
    expect(context.observations).toBe(0)
  })

  it("the student changes an estimate: the learned one follows their new number", () => {
    const target = open({ estimateMinutes: 120 })
    const learned = analyzeHistory(history([...past, target]), TODAY).estimates[target.task.id]
    expect(learned.userMinutes).toBe(120)
    expect(learned.minutes).toBe(Math.round((120 * (1 + 0.5 * (5 / 8))) / 5) * 5)
  })

  it("deleted tasks and sessions simply aren't in the history", () => {
    const target = open()
    const kept = past.slice(0, 2)
    expect(analyzeHistory(history([...kept, target]), TODAY).estimates).toEqual({})
  })

  it("partly done sessions count the minutes actually worked", () => {
    const items = Array.from({ length: 5 }, () => {
      const t = task({ status: "completed" })
      return { task: t, sessions: [session(t.id, addDays(TODAY, -2), "15:00", 120, { completedMinutes: 90 })] }
    })
    const target = open()
    expect(analyzeHistory(history([...items, target]), TODAY).estimates[target.task.id].basis.typicalRatio).toBe(1.5)
  })
})

describe("deterministic", () => {
  it("same history, same answer", () => {
    const past = Array.from({ length: 7 }, (_, i) => finished(70 + i * 5))
    const target = open()
    const h = history([...past, target])
    expect(analyzeHistory(h, TODAY)).toEqual(analyzeHistory(h, TODAY))
  })
})
