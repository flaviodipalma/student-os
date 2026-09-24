import "server-only"

import { fromMinutes, toMinutes } from "@/lib/events"
import { addDays } from "@/lib/format"
import { createPlanner, dayAvailability, modeStrategy, type DailyPlan, type PlanningStrategy } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import type { CalendarEvent, Task } from "@/lib/types"
import { availabilityOn, courseCodeOf, dayLabel, relativeDay, remainingMinutes, timeLabel, untrusted, type ToolContext } from "../assistant/context"
import type { ResolvedIntent } from "./intent"

// Planning scenarios: "what would my plan look like if…". A scenario is the
// deterministic Planner run on a TEMPORARY copy of the student's data with their
// intent applied (a strategy, temporary unavailable time, hypothetical task
// changes). Nothing here writes to the database; the Planner decides every
// time slot, so a scenario can never contain an impossible session.
//
//   PlanningIntent (from the AI, validated) -> resolveIntent -> buildScenario
//   -> planner input copy + strategy -> createPlanner -> DailyPlans -> summary

export type ScenarioSession = {
  taskId: string
  task: string
  course: string | null
  date: string
  start: string
  end: string
  startTime: string
  endTime: string
  minutes: number
  // The Planner's own "Why this?" reasons (including the student's focus).
  why: string[]
}

export type PlanningScenario = {
  label: string
  // feasible: every goal fits; partly-feasible: some work doesn't fit in time;
  // not-feasible: a goal gets no time at all before its target.
  status: "feasible" | "partly-feasible" | "not-feasible"
  // What this scenario assumed (so the answer can say it).
  assumptions: string[]
  days: { date: string; day: string; studyMinutes: number; dailyLimitMinutes: number; sessions: ScenarioSession[] }[]
  goals: { taskId: string; task: string; target: string; neededMinutes: number; plannedMinutes: number; fits: boolean }[]
  totals: { plannedStudyMinutes: number; workDueInWindowMinutes: number; studyCapacityMinutes: number }
  warnings: string[]
}

const BOOST = { focus: 40, course: 25, finishBy: 20 }

// The scenario's priorities: the mode (the one asked for, else the student's
// saved one), then focus courses, finish-by goals and focus tasks on top.
export function strategyFor(ctx: ToolContext, intent: ResolvedIntent, tasks: Task[]): PlanningStrategy {
  const saved = ctx.data.learning?.planningMode
  const mode = intent.mode ?? (saved === "custom" ? undefined : saved)
  const { boosts } = modeStrategy(mode, tasks, ctx.today, ctx.data.preferences.maxStudyMinutesPerDay, intent.mode ? "request" : "mode")
  const give = (taskId: string, points: number, label: string) => {
    if ((boosts[taskId]?.points ?? 0) < points) boosts[taskId] = { points, label }
  }
  const open = tasks.filter((task) => task.status !== "completed")
  for (const courseId of intent.focusCourseIds) {
    for (const task of open.filter((t) => t.courseId === courseId)) give(task.id, BOOST.course, `Your focus: ${courseCodeOf(ctx, courseId) ?? "this course"}`)
  }
  for (const goal of intent.finishBy) give(goal.taskId, BOOST.finishBy, `Your goal: finish by ${dayLabel(goal.date)}`)
  for (const taskId of intent.focusTaskIds) give(taskId, BOOST.focus, "You said this is your focus")
  return { boosts, dayLimits: intent.dayLimits }
}

export function buildScenario(ctx: ToolContext, intent: ResolvedIntent, options: { label: string; days: number }): PlanningScenario {
  const window = Array.from({ length: options.days }, (_, i) => addDays(ctx.today, i))
  const lastDay = window[window.length - 1]
  const prefs = ctx.data.preferences
  const assumptions: string[] = []

  // Hypothetical task changes and goals, on copies only.
  const title = (id: string) => untrusted(ctx.data.tasks.find((t) => t.id === id)?.title)
  const tasks: Task[] = ctx.data.tasks.map((task) => {
    let copy = task
    for (const change of intent.whatIf.filter((w) => w.taskId === task.id)) {
      if (change.dueDate) {
        copy = { ...copy, dueDate: change.dueDate }
        assumptions.push(`What if: "${title(task.id)}" is due ${dayLabel(change.dueDate)}`)
      }
      if (change.estimateMinutes) {
        copy = { ...copy, estimateMinutes: change.estimateMinutes }
        assumptions.push(`What if: "${title(task.id)}" takes ${change.estimateMinutes} minutes`)
      }
      if (change.completed) {
        copy = { ...copy, status: "completed" }
        assumptions.push(`What if: "${title(task.id)}" is finished`)
      }
    }
    for (const goal of intent.finishBy.filter((g) => g.taskId === task.id)) {
      if (goal.date < copy.dueDate) copy = { ...copy, dueDate: goal.date }
      assumptions.push(`Goal: finish "${title(task.id)}" by ${dayLabel(goal.date)}`)
    }
    return copy
  })

  const input = plannerInputFor({ ...ctx.data, tasks, timeZone: ctx.timeZone }, ctx.now, ctx.adaptive)
  // Temporary unavailable time: busy blocks in this simulation only (not events).
  const blocked: CalendarEvent[] = intent.unavailable.map((u, i) => ({
    id: `unavailable:${i}`,
    title: "Unavailable (you said)",
    date: u.date,
    startTime: u.from ?? "00:00",
    endTime: u.to ?? "23:59",
    type: "personal",
  }))
  for (const u of intent.unavailable) {
    assumptions.push(`You can't study ${relativeDay(ctx, u.date).toLowerCase()}${u.from || u.to ? ` ${timeLabel(u.from ?? prefs.studyStart)}–${timeLabel(u.to ?? prefs.studyEnd)}` : ""}`)
  }
  input.events = [...input.events, ...blocked]
  // Work the student doesn't want to do: skipped on those days (or the whole window).
  const skipped = { ...(input.skipped ?? {}) }
  for (const avoid of intent.avoid) {
    for (const date of avoid.date ? [avoid.date] : window) skipped[date] = [...(skipped[date] ?? []), ...avoid.taskIds]
    assumptions.push(`Not working on ${avoid.taskIds.length === 1 ? `"${title(avoid.taskIds[0])}"` : `${avoid.taskIds.length} tasks`}${avoid.date ? ` ${relativeDay(ctx, avoid.date).toLowerCase()}` : " in this plan"}`)
  }
  input.skipped = skipped
  input.strategy = strategyFor(ctx, intent, tasks)
  for (const [date, minutes] of Object.entries(intent.dayLimits)) assumptions.push(`At most ${minutes} minutes of study ${relativeDay(ctx, date).toLowerCase()}`)
  if (intent.mode) assumptions.push(`Mode: ${intent.mode}`)
  if (intent.focusTaskIds.length) assumptions.push(`Focus: ${intent.focusTaskIds.map((id) => `"${title(id)}"`).join(", ")}`)

  const planner = createPlanner(input)
  const plans: DailyPlan[] = window.map((date) => planner.planFor(date))
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const sessionView = (plan: DailyPlan): ScenarioSession[] =>
    plan.suggestions.map((s) => ({
      taskId: s.taskId,
      task: untrusted(byId.get(s.taskId)?.title),
      course: courseCodeOf(ctx, byId.get(s.taskId)?.courseId),
      date: s.date,
      start: timeLabel(s.startTime),
      end: timeLabel(s.endTime),
      startTime: s.startTime,
      endTime: s.endTime,
      minutes: toMinutes(s.endTime) - toMinutes(s.startTime),
      why: s.reasons.map((reason) => untrusted(reason, 120)),
    }))

  // Goals: the student's focus tasks and finish-by goals, and whether the plan gives them enough time.
  const goalIds = [...new Set([...intent.focusTaskIds, ...intent.finishBy.map((g) => g.taskId), ...intent.whatIf.map((w) => w.taskId)])]
  const goals = goalIds.flatMap((taskId) => {
    const task = byId.get(taskId)
    if (!task || task.status === "completed") return []
    const target = task.dueDate < ctx.today ? ctx.today : task.dueDate
    const ranked = plans[0].ranked.find((r) => r.task.id === taskId)
    const needed = ranked?.remainingMinutes ?? remainingMinutes(ctx, task) ?? 0
    const planned = plans.filter((p) => p.date <= target).flatMap((p) => p.suggestions).filter((s) => s.taskId === taskId).reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)
    return [{ taskId, task: untrusted(task.title), target: dayLabel(target), neededMinutes: needed, plannedMinutes: planned, fits: planned >= needed }]
  })

  const settingsOn = (date: string) => {
    const limit = intent.dayLimits[date]
    return limit === undefined ? planner.settings : { ...planner.settings, maxStudyMinutesPerDay: Math.min(planner.settings.maxStudyMinutesPerDay, limit) }
  }
  const capacity = window.reduce((sum, date) => {
    const day = dayAvailability(date, input.events, ctx.data.recurringCommitments, ctx.now, settingsOn(date))
    return sum + day.budget
  }, 0)
  const workDue = tasks
    .filter((task) => task.status !== "completed" && task.dueDate <= lastDay)
    .reduce((sum, task) => sum + (plans[0].ranked.find((r) => r.task.id === task.id)?.remainingMinutes ?? 0), 0)
  const warnings = [...new Set(plans.flatMap((p) => p.warnings.filter((w) => w.severity !== "low").map((w) => untrusted(w.message, 200))))].slice(0, 6)

  const status: PlanningScenario["status"] = goals.some((g) => g.neededMinutes > 0 && g.plannedMinutes === 0)
    ? "not-feasible"
    : goals.some((g) => !g.fits) || (goals.length === 0 && warnings.some((w) => /isn't enough|didn't fully fit/.test(w)))
      ? "partly-feasible"
      : "feasible"

  return {
    label: untrusted(options.label, 60),
    status,
    assumptions: [...new Set(assumptions)],
    days: plans.map((plan) => ({
      date: plan.date,
      day: relativeDay(ctx, plan.date),
      studyMinutes: plan.studyMinutes,
      dailyLimitMinutes: plan.studyLimit,
      sessions: sessionView(plan),
    })),
    goals,
    totals: {
      plannedStudyMinutes: plans.reduce((sum, p) => sum + p.suggestions.reduce((s, x) => s + toMinutes(x.endTime) - toMinutes(x.startTime), 0), 0),
      workDueInWindowMinutes: workDue,
      studyCapacityMinutes: capacity,
    },
    warnings,
  }
}

// Free times (the Planner's availability: outside class, work and other fixed
// items, inside the study window, from now) of at least `minutes`, across a
// range of days: the alternatives for "then when can I?".
export function findAvailableTimes(ctx: ToolContext, options: { minutes: number; from: string; to: string; between?: { from?: string; to?: string } }) {
  const lower = options.between?.from ? toMinutes(options.between.from) : 0
  const upper = options.between?.to ? toMinutes(options.between.to) : 24 * 60
  const out: { date: string; day: string; start: string; end: string; startTime: string; endTime: string; minutes: number }[] = []
  for (let date = options.from < ctx.today ? ctx.today : options.from; date <= options.to && out.length < 12; date = addDays(date, 1)) {
    for (const block of availabilityOn(ctx, date).free) {
      const start = Math.max(block.start, lower)
      const end = Math.min(block.end, upper)
      if (end - start < options.minutes) continue
      out.push({ date, day: relativeDay(ctx, date), start: timeLabel(fromMinutes(start)), end: timeLabel(fromMinutes(end)), startTime: fromMinutes(start), endTime: fromMinutes(end), minutes: end - start })
    }
  }
  return out.slice(0, 12)
}
