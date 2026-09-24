import "server-only"

import { z } from "zod"
import { addDays } from "@/lib/format"
import type { Task } from "@/lib/types"
import { dateKeySchema } from "@/lib/validation"
import { taskBrief, untrusted, type ToolContext } from "../assistant/context"
import { resolveCourse, resolveTask } from "../assistant/resolve"

// A PlanningIntent is what the student asked for, in a structure the Planner
// can use: the AI turns "I have soccer every afternoon, keep today light and
// focus on my exam" into this, and nothing else. It holds PREFERENCES and
// temporary constraints, never facts: it can't create events or change tasks.
// Hypothetical changes ("what if I move this to tomorrow?") only live in a
// simulation (scenario.ts).
//
// The AI's output is untrusted: it's parsed with this schema (strict: unknown
// fields are errors), and every task/course it names is resolved against the
// signed-in student's own data before anything runs.

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 17:00.")
const ref = z.string().trim().min(1).max(200)

export const planningModes = ["balanced", "deadline-focus", "exam-focus", "light-day"] as const

export const planningIntentSchema = z
  .object({
    mode: z
      .enum(planningModes)
      .default("balanced")
      .describe("balanced (normal), deadline-focus (what's due soonest), exam-focus (exams and quizzes), light-day (less study on the dates in lightDays, default today)."),
    focusTasks: z.array(ref).max(5).default([]).describe("Tasks the student wants to prioritize (taskId or title words)."),
    focusCourses: z.array(ref).max(5).default([]).describe("Courses the student wants to prioritize (code or name)."),
    avoid: z
      .array(z.object({ task: ref.optional(), course: ref.optional(), date: dateKeySchema.optional() }).strict())
      .max(10)
      .default([])
      .describe("Work the student doesn't want to do (on a date, or at all in this plan)."),
    unavailable: z
      .array(z.object({ date: dateKeySchema, from: time.optional(), to: time.optional() }).strict())
      .max(14)
      .default([])
      .describe("Times the student can't study (a whole day if no times): temporary, not saved as events."),
    lightDays: z.array(dateKeySchema).max(7).default([]).describe("Days to keep lighter (half the usual study limit)."),
    maxStudyMinutes: z
      .array(z.object({ date: dateKeySchema, minutes: z.int().min(0).max(720) }).strict())
      .max(14)
      .default([])
      .describe("A study limit the student asked for on a date."),
    finishBy: z
      .array(z.object({ task: ref, date: dateKeySchema }).strict())
      .max(5)
      .default([])
      .describe("The student's goal to finish a task by a date (earlier than its due date)."),
    whatIf: z
      .array(
        z
          .object({
            task: ref,
            dueDate: dateKeySchema.optional(),
            estimateMinutes: z.int().min(1).max(10000).optional(),
            completed: z.boolean().optional(),
          })
          .strict()
      )
      .max(5)
      .default([])
      .describe("Hypothetical task changes for a what-if (never saved)."),
  })
  .strict()

export type PlanningIntent = z.infer<typeof planningIntentSchema>

// The intent with every reference checked and turned into the student's own ids.
export type ResolvedIntent = {
  mode: PlanningIntent["mode"]
  focusTaskIds: string[]
  focusCourseIds: string[]
  avoid: { taskIds: string[]; date?: string }[]
  unavailable: PlanningIntent["unavailable"]
  dayLimits: Record<string, number>
  finishBy: { taskId: string; date: string }[]
  whatIf: { taskId: string; dueDate?: string; estimateMinutes?: number; completed?: boolean }[]
}

export type IntentProblem =
  | { status: "ambiguous"; about: string; options: ReturnType<typeof taskBrief>[] | { courseId: string; code: string; name: string }[] }
  | { status: "not_found"; about: string }
  | { status: "invalid"; problem: string }

// How far ahead a plan can be shaped (the Planner looks two weeks ahead).
const HORIZON_DAYS = 30

export function resolveIntent(ctx: ToolContext, intent: PlanningIntent): { ok: true; intent: ResolvedIntent } | { ok: false; problem: IntentProblem } {
  const lastDay = addDays(ctx.today, HORIZON_DAYS)
  const dates = [
    ...intent.avoid.flatMap((a) => (a.date ? [a.date] : [])),
    ...intent.unavailable.map((u) => u.date),
    ...intent.lightDays,
    ...intent.maxStudyMinutes.map((m) => m.date),
    ...intent.finishBy.map((f) => f.date),
  ]
  const outside = dates.find((date) => date < ctx.today || date > lastDay)
  if (outside) return { ok: false, problem: { status: "invalid", problem: `${outside} is outside the planning range (today to ${lastDay}).` } }
  for (const u of intent.unavailable) {
    if (u.from && u.to && u.to <= u.from) return { ok: false, problem: { status: "invalid", problem: "An unavailable time must end after it starts." } }
  }

  const task = (value: string): Task | IntentProblem => {
    const found = resolveTask(ctx.data.tasks, value)
    if ("found" in found) return found.found
    if ("ambiguous" in found) return { status: "ambiguous", about: untrusted(value, 60), options: found.ambiguous.map((t) => taskBrief(ctx, t)) }
    return { status: "not_found", about: untrusted(value, 60) }
  }
  const course = (value: string) => {
    const found = resolveCourse(ctx.data.courses, value)
    if ("found" in found) return found.found
    if ("ambiguous" in found) {
      return { status: "ambiguous" as const, about: untrusted(value, 60), options: found.ambiguous.map((c) => ({ courseId: c.id, code: untrusted(c.code, 40), name: untrusted(c.name) })) }
    }
    return { status: "not_found" as const, about: untrusted(value, 60) }
  }
  // Tasks and courses have an id; problems don't (tasks have a status too).
  const isProblem = (value: object): value is IntentProblem => !("id" in value)

  const focusTaskIds: string[] = []
  for (const value of intent.focusTasks) {
    const found = task(value)
    if (isProblem(found)) return { ok: false, problem: found }
    focusTaskIds.push(found.id)
  }
  const focusCourseIds: string[] = []
  for (const value of intent.focusCourses) {
    const found = course(value)
    if (isProblem(found)) return { ok: false, problem: found }
    focusCourseIds.push(found.id)
  }
  const avoid: ResolvedIntent["avoid"] = []
  for (const item of intent.avoid) {
    if (!item.task && !item.course) return { ok: false, problem: { status: "invalid", problem: "Say which task or course to avoid." } }
    if (item.task) {
      const found = task(item.task)
      if (isProblem(found)) return { ok: false, problem: found }
      avoid.push({ taskIds: [found.id], date: item.date })
    }
    if (item.course) {
      const found = course(item.course)
      if (isProblem(found)) return { ok: false, problem: found }
      avoid.push({ taskIds: ctx.data.tasks.filter((t) => t.courseId === found.id).map((t) => t.id), date: item.date })
    }
  }
  const finishBy: ResolvedIntent["finishBy"] = []
  for (const item of intent.finishBy) {
    const found = task(item.task)
    if (isProblem(found)) return { ok: false, problem: found }
    finishBy.push({ taskId: found.id, date: item.date })
  }
  const whatIf: ResolvedIntent["whatIf"] = []
  for (const item of intent.whatIf) {
    const found = task(item.task)
    if (isProblem(found)) return { ok: false, problem: found }
    whatIf.push({ taskId: found.id, dueDate: item.dueDate, estimateMinutes: item.estimateMinutes, completed: item.completed })
  }

  // Light days: half the usual limit; an explicit limit wins.
  const usual = ctx.data.preferences.maxStudyMinutesPerDay
  const dayLimits: Record<string, number> = {}
  const light = intent.mode === "light-day" && intent.lightDays.length === 0 ? [ctx.today] : intent.lightDays
  for (const date of light) dayLimits[date] = Math.round(usual / 2 / 15) * 15
  for (const { date, minutes } of intent.maxStudyMinutes) dayLimits[date] = Math.min(minutes, usual)

  return { ok: true, intent: { mode: intent.mode, focusTaskIds, focusCourseIds, avoid, unavailable: intent.unavailable, dayLimits, finishBy, whatIf } }
}
