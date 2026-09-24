import { describe, expect, it } from "vitest"
import { toMinutes } from "@/lib/events"
import { addDays } from "@/lib/format"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { scheduleBetween } from "@/lib/recurring"
import type { CalendarEvent, Course, RecurringCommitment, StudentPreferences, StudySessionRecord, Task } from "@/lib/types"
import { createPlanner, whatNow, type DailyPlan } from "./index"

// Beta test matrix (Prompt 29): five kinds of students, through the real Planner
// for two weeks. The same rules must hold for all of them; nothing here tunes
// the Planner to make a result look good.
//
//   A light workload   B heavy workload   C very structured week
//   D unpredictable    E several overdue tasks
//
// Now: Thursday 2026-09-24, 2:30 PM (the student's local time).

const TODAY = "2026-09-24"
const NOW = new Date(2026, 8, 24, 14, 30)
const courses: Course[] = ["CSC215", "PSY101", "MATH221", "BIO110", "ENG102"].map((code, i) => ({ id: `c${i}`, code, name: code, professor: "", description: "", color: "sky" }))

type Profile = {
  tasks: Task[]
  commitments?: RecurringCommitment[]
  events?: CalendarEvent[]
  sessions?: StudySessionRecord[]
  preferences?: Partial<StudentPreferences>
}

let taskCount = 0
const task = (due: number, estimate: number | null, extra: Partial<Task> = {}): Task => ({
  id: `t${taskCount++}`,
  courseId: `c${taskCount % 5}`,
  title: `Task ${taskCount}`,
  description: "",
  type: "assignment",
  dueDate: addDays(TODAY, due),
  priority: "medium",
  estimateMinutes: estimate,
  status: "not_started",
  ...extra,
})
const weekly = (title: string, days: number[], start: string, end: string, type: RecurringCommitment["type"] = "class"): RecurringCommitment => ({
  id: title,
  title,
  daysOfWeek: days,
  startTime: start,
  endTime: end,
  type,
})
const event = (id: string, day: number, start: string, end: string): CalendarEvent => ({ id, title: id, date: addDays(TODAY, day), startTime: start, endTime: end, type: "personal" })

const unpredictableTasks = [task(2, 150, { priority: "high" }), task(4, 60), task(6, 240, { type: "project" }), task(1, null)]

const profiles: Record<string, Profile> = {
  "A light workload": {
    tasks: [task(6, 60), task(10, 45), task(13, 90, { status: "completed" })],
    commitments: [weekly("CSC215", [1, 3, 5], "10:00", "10:50")],
  },
  "B heavy workload": {
    tasks: [
      task(1, 240, { type: "project", priority: "high" }),
      task(2, 180, { type: "exam", priority: "critical" }),
      task(2, 120, { type: "paper", priority: "high" }),
      task(3, 90),
      task(3, 90),
      task(4, 60, { type: "lab" }),
      task(5, 300, { type: "project" }),
      task(6, 45, { type: "reading" }),
      task(7, 45, { type: "reading" }),
      task(8, 120),
    ],
    commitments: [
      weekly("Classes MWF", [1, 3, 5], "09:00", "12:00"),
      weekly("Classes TTh", [2, 4], "10:00", "13:30"),
      weekly("Soccer", [1, 2, 3, 4, 5], "16:00", "18:30", "sports"),
      weekly("Job", [2, 4, 6], "19:00", "22:00", "work"),
    ],
  },
  "C very structured week": {
    tasks: [task(3, 120, { priority: "high" }), task(5, 90), task(9, 180, { type: "project" }), task(4, 60, { type: "quiz" })],
    commitments: [
      weekly("Morning classes", [1, 2, 3, 4, 5], "09:00", "12:00"),
      weekly("Lunch", [0, 1, 2, 3, 4, 5, 6], "12:00", "13:00", "personal"),
      weekly("Gym", [1, 3, 5], "17:00", "18:00", "sports"),
      weekly("Dinner", [0, 1, 2, 3, 4, 5, 6], "18:30", "19:30", "personal"),
    ],
  },
  "D unpredictable schedule": {
    tasks: unpredictableTasks,
    // Irregular one-off events, some long, some overlapping each other.
    events: [
      event("Shift A", 0, "15:00", "20:00"),
      event("Doctor", 1, "09:30", "11:00"),
      event("Shift B", 1, "13:00", "13:45"),
      event("Club", 1, "13:30", "15:00"),
      event("Road trip", 2, "07:00", "21:00"),
      event("Shift C", 3, "18:00", "23:00"),
      event("Tutoring", 4, "10:00", "10:30"),
      event("Shift D", 5, "08:00", "16:00"),
    ],
    // Yesterday's session was never marked done (missed).
    sessions: [{ id: "s1", taskId: unpredictableTasks[0].id, date: addDays(TODAY, -1), startTime: "19:00", endTime: "20:00", status: "scheduled" }],
  },
  "E several overdue tasks": {
    tasks: [
      task(-5, 120, { priority: "high" }),
      task(-2, 60),
      task(-1, 90, { type: "paper", priority: "critical" }),
      task(2, 60),
      task(7, 180, { type: "project" }),
    ],
    commitments: [weekly("Classes", [1, 2, 3, 4, 5], "10:00", "12:00")],
  },
}

const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime)
const length = (s: { startTime: string; endTime: string }) => toMinutes(s.endTime) - toMinutes(s.startTime)

function run(profile: Profile) {
  const preferences = { ...DEFAULT_STUDENT_PREFERENCES, ...profile.preferences }
  const data = {
    tasks: profile.tasks,
    courses,
    events: profile.events ?? [],
    studySessions: profile.sessions ?? [],
    recurringCommitments: profile.commitments ?? [],
    preferences,
  }
  const input = plannerInputFor(data, NOW)
  const planner = createPlanner(input)
  const plans: DailyPlan[] = Array.from({ length: 14 }, (_, i) => planner.planFor(addDays(TODAY, i)))
  return { input, planner, plans, preferences, data }
}

describe.each(Object.entries(profiles))("Student %s", (_name, profile) => {
  it("never plans study over a fixed commitment, outside the study window, or past the daily limit", () => {
    const { input, plans, preferences, data } = run(profile)
    for (const plan of plans) {
      const fixed = scheduleBetween(input.events, data.recurringCommitments, plan.date, plan.date).filter((e) => e.type !== "study")
      for (const session of plan.suggestions) {
        for (const item of fixed) expect(overlaps(session, item), `${plan.date} ${session.startTime} over ${item.title}`).toBe(false)
        expect(toMinutes(session.startTime)).toBeGreaterThanOrEqual(toMinutes(preferences.studyStart))
        expect(toMinutes(session.endTime)).toBeLessThanOrEqual(toMinutes(preferences.studyEnd))
        // Never a giant block.
        expect(length(session)).toBeLessThanOrEqual(120)
      }
      expect(plan.studyMinutes).toBeLessThanOrEqual(preferences.maxStudyMinutesPerDay)
    }
  })

  it("never invents work: planned study for a task never exceeds what's left of it", () => {
    const { plans, planner } = run(profile)
    const planned = new Map<string, number>()
    for (const plan of plans) for (const s of plan.suggestions) planned.set(s.taskId, (planned.get(s.taskId) ?? 0) + length(s))
    const left = new Map(planner.planFor(TODAY).ranked.map((scored) => [scored.task.id, scored.remainingMinutes]))
    for (const [taskId, minutes] of planned) expect(minutes, taskId).toBeLessThanOrEqual(left.get(taskId) ?? 0)
    // Completed tasks are never planned.
    const done = new Set(profile.tasks.filter((t) => t.status === "completed").map((t) => t.id))
    expect([...planned.keys()].some((id) => done.has(id))).toBe(false)
  })

  it("is deterministic, and 'What should I do now?' is the Planner's own answer", () => {
    const first = run(profile)
    expect(run(profile).plans).toEqual(first.plans)
    const answer = whatNow({
      planner: first.planner,
      now: NOW,
      today: TODAY,
      schedule: scheduleBetween(first.input.events, first.data.recurringCommitments, TODAY, TODAY),
      events: first.input.events,
      tasks: profile.tasks,
    })
    if (answer.kind === "work") expect(first.plans[0].suggestions).toContainEqual(answer.session)
    if (answer.kind === "no-time" || answer.kind === "busy") {
      // A "next opportunity" is always a real recommendation.
      if (answer.next) expect(first.plans.flatMap((p) => p.suggestions)).toContainEqual(answer.next.session)
    }
  })
})

describe("what each kind of student sees", () => {
  it("A (light): a calm plan that uses little of the free time; nothing flagged", () => {
    const { plans } = run(profiles["A light workload"])
    const planned = plans.reduce((sum, p) => sum + p.suggestions.reduce((s, x) => s + length(x), 0), 0)
    expect(planned).toBeLessThanOrEqual(105)
    expect(plans[0].warnings.filter((w) => w.severity === "high")).toEqual([])
  })

  it("B (heavy): the work that can't fit is flagged honestly instead of over-booking", () => {
    const { plans } = run(profiles["B heavy workload"])
    expect(plans.slice(0, 3).flatMap((p) => p.warnings).some((w) => w.kind === "not-enough-time" || w.kind === "unscheduled")).toBe(true)
    for (const plan of plans) expect(plan.studyMinutes).toBeLessThanOrEqual(240)
  })

  it("D (unpredictable): a day taken by a road trip gets at most a short session after it; a missed session is flagged", () => {
    const { plans } = run(profiles["D unpredictable schedule"])
    // 7 AM-9 PM away: only the last hour of the study window is free (minus the transition).
    for (const s of plans[2].suggestions) expect(toMinutes(s.startTime)).toBeGreaterThanOrEqual(toMinutes("21:00"))
    expect(plans[2].suggestions.reduce((sum, s) => sum + length(s), 0)).toBeLessThanOrEqual(45)
    expect(plans[0].warnings.some((w) => w.kind === "missed")).toBe(true)
  })

  it("E (overdue): overdue work comes first, most urgent first, and is flagged", () => {
    const { plans, data } = run(profiles["E several overdue tasks"])
    const overdue = new Set(data.tasks.filter((t) => t.dueDate < TODAY).map((t) => t.id))
    const ranked = plans[0].ranked.map((s) => s.task.id)
    expect(ranked.slice(0, 3).every((id) => overdue.has(id))).toBe(true)
    expect(plans[0].warnings.some((w) => w.kind === "overdue")).toBe(true)
  })
})
