import "server-only"

import { z } from "zod"
import type { PlannedBlock } from "@/lib/assistant"
import { planningModes as planningModesAll, studyPeriods } from "@/lib/types"
import { addDays, formatDuration } from "@/lib/format"
import { createPlanner } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { planningIntentSchema, planningModes, resolveIntent, type IntentProblem, type PlanningIntent, type ResolvedIntent } from "../planning/intent"
import { buildScenario, findAvailableTimes as freeTimes, type PlanningScenario } from "../planning/scenario"
import { prepareAction } from "./action-tools"
import { availabilityOn, relativeDay, remainingMinutes, taskBrief, timeLabel, untrusted, type ToolContext } from "./context"
import { resolveTask } from "./resolve"
import { dateInput, defineTool, taskRefInput, timeInput, type ToolOutput } from "./tool"

// The AI planning layer's tools. The model turns what the student says into a
// PlanningIntent (planning/intent.ts): preferences and temporary constraints,
// never facts. The deterministic Planner does all the scheduling: every
// scenario here is the real Planner run on a temporary copy of the student's
// data (planning/scenario.ts), so a plan can't put study over class, work or
// practice, outside the study window or past the daily limit. Nothing here saves
// anything, except applyConfirmedPlanChange, which only PROPOSES a change the
// student then confirms (like every other change).

const HYPOTHETICAL = "Hypothetical: nothing was saved. Describe it as a possible plan, not as done."

function intentProblem(problem: IntentProblem): ToolOutput {
  switch (problem.status) {
    case "ambiguous":
      return { result: { status: "ambiguous", about: problem.about, instruction: "Ask the student which one they mean. Plan nothing yet.", options: problem.options } }
    case "not_found":
      return { result: { status: "not_found", about: problem.about, problem: "Nothing in Student OS matches that. Don't make it up; ask the student." } }
    case "invalid":
      return { result: { status: "not_possible", problem: problem.problem } }
  }
}

// A scenario, trimmed for the model: only days with study, and every number the
// answer needs, so the model never has to estimate anything itself.
function scenarioView(s: PlanningScenario) {
  return {
    label: s.label,
    feasibility: s.status,
    assumptions: s.assumptions,
    goals: s.goals.map((g) => ({ ...g, needed: formatDuration(g.neededMinutes), planned: formatDuration(g.plannedMinutes) })),
    days: s.days
      .filter((d) => d.sessions.length > 0)
      .map((d) => ({
        date: d.date,
        day: d.day,
        study: formatDuration(d.studyMinutes),
        dailyLimit: formatDuration(d.dailyLimitMinutes),
        sessions: d.sessions.map(({ taskId, task, course, start, end, minutes, why }) => ({ taskId, task, course, start, end, minutes, why })),
      })),
    daysWithoutStudy: s.days.filter((d) => d.sessions.length === 0).map((d) => d.day),
    totals: {
      plannedStudy: formatDuration(s.totals.plannedStudyMinutes),
      workDueInThisPeriod: formatDuration(s.totals.workDueInWindowMinutes),
      realisticStudyTime: formatDuration(s.totals.studyCapacityMinutes),
    },
    warnings: s.warnings,
  }
}

const EMPTY_INTENT: PlanningIntent = planningIntentSchema.parse({})
const daysInput = z.int().min(1).max(14).default(7).describe("How many days to plan, starting today.")
const intentInput = planningIntentSchema.describe(
  "What the student asked for, as preferences and temporary constraints. Include only what they said; never invent constraints."
)

function resolved(ctx: ToolContext, intent: PlanningIntent): { ok: true; intent: ResolvedIntent } | { ok: false; output: ToolOutput } {
  const result = resolveIntent(ctx, intent)
  return result.ok ? result : { ok: false, output: intentProblem(result.problem) }
}

// ---- Read-only planning tools.

export const getPlanningContext = defineTool({
  name: "getPlanningContext",
  description:
    "The numbers behind a planning conversation, from real data: work left on tasks due by `until` (estimate minus work done) versus realistic study time until then (the Planner's budget: free time inside the study window, the daily limit, and time kept free), per day, plus the study window, limits, the planning modes and the Planner's warnings. Use for \"am I behind?\", \"can I get this done by Friday?\", \"why is tomorrow so busy?\".",
  input: z.object({ until: dateInput.optional().describe("Default: 6 days from today.") }),
  run(ctx, { until: requested }) {
    const until = requested && requested >= ctx.today ? (requested > addDays(ctx.today, 30) ? addDays(ctx.today, 30) : requested) : addDays(ctx.today, 6)
    const due = ctx.data.tasks.filter((task) => task.status !== "completed" && task.dueDate <= until)
    const left = due.map((task) => ({ task, minutes: remainingMinutes(ctx, task) }))
    const perDay: { day: string; date: string; freeMinutes: number; realisticStudyMinutes: number; alreadyBookedMinutes: number; busyWith: string[] }[] = []
    for (let date = ctx.today; date <= until; date = addDays(date, 1)) {
      const day = availabilityOn(ctx, date)
      perDay.push({
        date,
        day: relativeDay(ctx, date),
        freeMinutes: day.freeMinutes,
        realisticStudyMinutes: day.budget + day.bookedStudyMinutes,
        alreadyBookedMinutes: day.bookedStudyMinutes,
        busyWith: day.items.filter((item) => item.type !== "study").slice(0, 6).map((item) => `${untrusted(item.title, 60)} ${timeLabel(item.startTime)}–${timeLabel(item.endTime)}`),
      })
    }
    const work = left.reduce((sum, l) => sum + (l.minutes ?? 0), 0)
    const capacity = perDay.reduce((sum, d) => sum + d.realisticStudyMinutes, 0)
    const prefs = ctx.data.preferences
    return {
      result: {
        from: ctx.today,
        until,
        workLeft: formatDuration(work),
        workLeftMinutes: work,
        realisticStudyTime: formatDuration(capacity),
        realisticStudyMinutes: capacity,
        enoughTime: work <= capacity,
        tasksDue: left
          .sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate))
          .slice(0, 12)
          .map((l) => ({ ...taskBrief(ctx, l.task), workLeftMinutes: l.minutes })),
        tasksWithoutEstimate: left.filter((l) => l.minutes === null).length,
        perDay,
        studyWindow: { start: timeLabel(prefs.studyStart), end: timeLabel(prefs.studyEnd) },
        dailyStudyLimit: formatDuration(prefs.maxStudyMinutesPerDay),
        modes: planningModes,
        warnings: ctx.planner.planFor(ctx.today).warnings.map((w) => untrusted(w.message, 200)),
      },
    }
  },
})

export const explainPlan = defineTool({
  name: "explainPlan",
  description:
    "Why the Planner planned a day the way it did: every open task ranked with its score and the reasons (deadline, priority, type, work left, overdue...), which ones got time and when, why others didn't (daily limit, no free time, skipped), and what fills the day. Use for \"why am I doing this now?\", \"why not my other assignment?\", \"why is tomorrow so busy?\". Pass a task to focus on it.",
  input: z.object({ date: dateInput.optional().describe("Default: today."), task: taskRefInput.optional() }),
  run(ctx, { date: requested, task: ref }) {
    const date = requested && requested >= ctx.today ? requested : ctx.today
    let focus: string | undefined
    if (ref) {
      const found = resolveTask(ctx.data.tasks, ref)
      if ("found" in found) focus = found.found.id
    }
    const plan = ctx.planner.planFor(date)
    const day = availabilityOn(ctx, date)
    const planned = new Map<string, string[]>()
    for (const s of plan.suggestions) planned.set(s.taskId, [...(planned.get(s.taskId) ?? []), `${timeLabel(s.startTime)}–${timeLabel(s.endTime)}`])
    const ranked = plan.ranked.slice(0, focus ? 20 : 8).map((r, i) => ({
      rank: i + 1,
      ...taskBrief(ctx, r.task),
      score: r.score,
      reasons: r.factors.map((f) => `${untrusted(f.label, 100)} (+${f.points})`),
      workLeftMinutes: r.remainingMinutes,
      plannedThisDay: planned.get(r.task.id) ?? [],
    }))
    return {
      focusTaskId: focus,
      result: {
        date,
        day: relativeDay(ctx, date),
        howThePlannerDecides:
          "Tasks are ranked by score (sooner deadline, higher priority, exams and big projects, more work left, overdue). The highest-ranked get the earliest free blocks, up to the daily limit and keeping part of the day free.",
        ...(focus ? { focus: ranked.find((r) => r.taskId === focus) ?? { note: "That task isn't in this day's ranking (done, skipped that day or not due soon)." } } : {}),
        ranked: focus ? ranked.filter((r) => r.taskId === focus || r.rank <= 5) : ranked,
        sessions: plan.suggestions.map((s) => ({ taskId: s.taskId, start: timeLabel(s.startTime), end: timeLabel(s.endTime), why: s.reasons.map((r) => untrusted(r, 120)) })),
        studyPlanned: formatDuration(plan.studyMinutes),
        dailyLimit: formatDuration(plan.studyLimit),
        freeTime: formatDuration(day.freeMinutes),
        fixedItems: day.items
          .filter((item) => item.type !== "study")
          .map((item) => `${untrusted(item.title, 60)} ${timeLabel(item.startTime)}–${timeLabel(item.endTime)}`),
        warnings: plan.warnings.map((w) => untrusted(w.message, 200)),
      },
    }
  },
})

export const simulatePlanChange = defineTool({
  name: "simulatePlanChange",
  description:
    "What-if: runs the real Planner on a temporary copy with the student's intent applied (mode, focus, unavailable times, lighter days, a finish-by goal, or hypothetical task changes like a new due date) and compares it with the current plan. Saves NOTHING. Use for \"what if I don't study tonight?\", \"what if I move this to tomorrow?\", \"I can't study Wednesday\", \"I want to finish X before Friday\". To keep a plan afterwards, use applyConfirmedPlanChange (or updateTask for a real deadline change).",
  input: z.object({ intent: intentInput, days: daysInput }),
  run(ctx, { intent, days }) {
    const r = resolved(ctx, intent)
    if (!r.ok) return r.output
    const scenario = buildScenario(ctx, r.intent, { label: "With your change", days })
    const current = buildScenario(ctx, emptyResolved(), { label: "Current plan", days })
    const focusTaskId = r.intent.focusTaskIds[0] ?? r.intent.finishBy[0]?.taskId ?? r.intent.whatIf[0]?.taskId
    return {
      focusTaskId,
      result: {
        status: "simulated",
        note: HYPOTHETICAL,
        scenario: scenarioView(scenario),
        comparedWithCurrentPlan: compare(current, scenario),
      },
    }
  },
})

export const generatePlanningScenarios = defineTool({
  name: "generatePlanningScenarios",
  description:
    "Compare 2-3 ways to plan (e.g. \"finish the paper tonight\" vs \"study for tomorrow's exam\", or balanced vs exam focus): each option is a PlanningIntent run through the real Planner on a temporary copy. Returns each plan, whether the goals fit, and a deterministic ranking (feasible first, then more goals met, then fewer warnings). Saves NOTHING.",
  input: z.object({
    options: z.array(z.object({ label: z.string().trim().min(1).max(60), intent: intentInput }).strict()).min(2).max(3),
    days: daysInput,
  }),
  run(ctx, { options, days }) {
    const scenarios: PlanningScenario[] = []
    for (const option of options) {
      const r = resolved(ctx, option.intent)
      if (!r.ok) return r.output
      scenarios.push(buildScenario(ctx, r.intent, { label: option.label, days }))
    }
    const order = { feasible: 0, "partly-feasible": 1, "not-feasible": 2 }
    const ranking = scenarios
      .map((s, i) => ({ i, s, met: s.goals.filter((g) => g.fits).length }))
      .sort((a, b) => order[a.s.status] - order[b.s.status] || b.met - a.met || a.s.warnings.length - b.s.warnings.length || a.i - b.i)
    return {
      result: {
        status: "simulated",
        note: HYPOTHETICAL,
        scenarios: scenarios.map(scenarioView),
        ranking: ranking.map((r, n) => ({ rank: n + 1, label: r.s.label, feasibility: r.s.status, goalsMet: `${r.met} of ${r.s.goals.length}`, warnings: r.s.warnings.length })),
        instruction: "Recommend the top-ranked option unless the student's own priorities say otherwise, and explain the trade-off with these numbers.",
      },
    }
  },
})

export const findAvailableTimes = defineTool({
  name: "findAvailableTimes",
  description:
    "Free times of at least `minutes` over a range of days (the Planner's availability: not during class, work, practice or other events, inside the study window, from now). Use for alternatives when a requested time isn't free (\"then when can I?\"), e.g. evenings only with between 18:00-23:00.",
  input: z.object({
    minutes: z.int().min(15).max(480).default(60),
    from: dateInput.optional().describe("Default: today."),
    to: dateInput.optional().describe("Default: 6 days after `from`. At most 14 days."),
    between: z.object({ from: timeInput.optional(), to: timeInput.optional() }).strict().optional(),
  }),
  run(ctx, { minutes, from: rawFrom, to: rawTo, between }) {
    const from = rawFrom && rawFrom > ctx.today ? rawFrom : ctx.today
    const last = addDays(from, 13)
    const to = rawTo ? (rawTo > last ? last : rawTo) : addDays(from, 6)
    if (to < from) return { result: { status: "not_possible", problem: "That range ends before it starts." } }
    const times = freeTimes(ctx, { minutes, from, to, between })
    return {
      result: {
        from,
        to,
        minutes,
        times: times.map(({ date, day, start, end, startTime, endTime, minutes: m }) => ({ date, day, start, end, startTime, endTime, minutes: m })),
        ...(times.length === 0 ? { note: "No free time that long in this range. Try shorter sessions or other days." } : {}),
      },
    }
  },
})

// ---- The one planning tool that leads to a change (after Confirm).

export const applyConfirmedPlanChange = defineTool({
  name: "applyConfirmedPlanChange",
  description:
    "Propose a real plan change for one day, after the student agreed to it: `accept-day` puts that day's plan (the Planner's sessions, with the same intent you simulated) on the calendar; `skip-day` takes the day off (its planned work moves to other days, like Skip on the Planner page). The student confirms before anything is saved. What-if task changes can't be applied here: use updateTask for a real deadline change.",
  input: z.object({
    change: z.enum(["accept-day", "skip-day"]),
    date: dateInput,
    intent: intentInput.optional().describe("accept-day only: the intent of the plan the student agreed to."),
  }),
  run(ctx, { change, date, intent }) {
    if (date < ctx.today) return { result: { status: "not_possible", problem: "That day has already passed." } }
    if (date > addDays(ctx.today, 13)) return { result: { status: "not_possible", problem: "Plans can be applied up to two weeks ahead." } }
    const r = resolved(ctx, intent ?? EMPTY_INTENT)
    if (!r.ok) return r.output
    if (r.intent.whatIf.length > 0) {
      return { result: { status: "not_possible", problem: "A what-if isn't real. Change the task first (updateTask), then plan with it." } }
    }

    const days = Math.round((Date.parse(date) - Date.parse(ctx.today)) / 86_400_000) + 1
    let sessions: PlannedBlock[]
    if (change === "accept-day") {
      const scenario = buildScenario(ctx, r.intent, { label: "Accepted plan", days })
      sessions = scenario.days.at(-1)!.sessions.map(({ taskId, startTime, endTime }) => ({ taskId, startTime, endTime }))
      if (sessions.length === 0) return { result: { status: "not_possible", problem: `The Planner has no new study for ${relativeDay(ctx, date).toLowerCase()}.` } }
    } else {
      sessions = plannedWork(ctx, date)
      if (sessions.length === 0) return { result: { status: "not_possible", problem: `There's no planned study to skip ${relativeDay(ctx, date).toLowerCase()}.` } }
    }

    const check = prepareAction(ctx, { kind: change === "accept-day" ? "accept-sessions" : "skip-day", date, sessions })
    if (!check.ok) return { result: { status: "not_possible", problem: check.problem } }
    const booked = ctx.data.studySessions.filter((s) => s.date === date && s.status === "scheduled")
    const note = [
      check.pending.note,
      change === "skip-day" && booked.length > 0
        ? `You also have ${booked.length === 1 ? "a scheduled study session" : `${booked.length} scheduled study sessions`} that day; move or skip ${booked.length === 1 ? "it" : "them"} on the Planner page.`
        : undefined,
    ]
      .filter(Boolean)
      .join(" ")
    const pending = { ...check.pending, ...(note ? { note } : {}) }
    return {
      focusTaskId: sessions[0]?.taskId,
      pending,
      result: {
        status: "needs_confirmation",
        summary: pending.summary,
        ...(note ? { note } : {}),
        instruction: "Nothing is saved yet. The student sees Confirm / Cancel buttons. Say in one short sentence what will change and ask them to confirm. Don't say it's done.",
      },
    }
  },
})

// All the study the Planner would put on a day, found by skipping what it
// plans until nothing is left (skipping one task can make room for another).
function plannedWork(ctx: ToolContext, date: string): PlannedBlock[] {
  const input = plannerInputFor({ ...ctx.data, timeZone: ctx.timeZone }, ctx.now, ctx.adaptive)
  const skipped = [...(input.skipped?.[date] ?? [])]
  const blocks: PlannedBlock[] = []
  for (let round = 0; round < 8; round++) {
    const plan = createPlanner({ ...input, skipped: { ...input.skipped, [date]: skipped } }).planFor(date)
    const fresh = plan.suggestions.filter((s) => !skipped.includes(s.taskId))
    if (fresh.length === 0) break
    for (const s of fresh) {
      if (!blocks.some((b) => b.taskId === s.taskId)) blocks.push({ taskId: s.taskId, startTime: s.startTime, endTime: s.endTime })
      skipped.push(s.taskId)
    }
  }
  return blocks.slice(0, 8)
}

function emptyResolved(): ResolvedIntent {
  // No mode: the student's saved planning mode applies.
  return { mode: undefined, focusTaskIds: [], focusCourseIds: [], avoid: [], unavailable: [], dayLimits: {}, finishBy: [], whatIf: [] }
}

// What changed between the current plan and the scenario, per day and per goal.
function compare(current: PlanningScenario, next: PlanningScenario) {
  const studyByDay = (s: PlanningScenario) => new Map(s.days.map((d) => [d.date, d]))
  const before = studyByDay(current)
  const days = next.days
    .map((d) => {
      const was = before.get(d.date)
      return { day: d.day, before: formatDuration(was?.studyMinutes ?? 0), after: formatDuration(d.studyMinutes), changed: (was?.studyMinutes ?? 0) !== d.studyMinutes || sessionsKey(was) !== sessionsKey(d) }
    })
    .filter((d) => d.changed)
    .map(({ day, before: b, after }) => ({ day, study: `${b} → ${after}` }))
  // Per task, today and tomorrow: which work moves, and where it goes.
  const minutesOn = (s: PlanningScenario, index: number) => {
    const out = new Map<string, { task: string; minutes: number }>()
    for (const x of s.days[index]?.sessions ?? []) out.set(x.taskId, { task: x.task, minutes: (out.get(x.taskId)?.minutes ?? 0) + x.minutes })
    return out
  }
  const [todayBefore, todayAfter, tomorrowBefore, tomorrowAfter] = [minutesOn(current, 0), minutesOn(next, 0), minutesOn(current, 1), minutesOn(next, 1)]
  const tasksThatMove = [...new Set([...todayBefore.keys(), ...todayAfter.keys()])]
    .map((id) => {
      const before = todayBefore.get(id)?.minutes ?? 0
      const after = todayAfter.get(id)?.minutes ?? 0
      const tomorrow = (tomorrowAfter.get(id)?.minutes ?? 0) - (tomorrowBefore.get(id)?.minutes ?? 0)
      return { taskId: id, task: (todayBefore.get(id) ?? todayAfter.get(id))!.task, today: `${formatDuration(before)} → ${formatDuration(after)}`, change: after - before, tomorrowChange: tomorrow }
    })
    .filter((t) => t.change !== 0)
    .map(({ change, tomorrowChange, ...t }) => ({ ...t, ...(tomorrowChange !== 0 ? { tomorrow: `${tomorrowChange > 0 ? "+" : "−"}${formatDuration(Math.abs(tomorrowChange))}` } : {}), ...(change < 0 ? {} : { more: true }) }))
  const movedFromToday = [...todayBefore.entries()].reduce((sum, [id, b]) => sum + Math.max(0, b.minutes - (todayAfter.get(id)?.minutes ?? 0)), 0)
  const sum = (m: Map<string, { minutes: number }>) => [...m.values()].reduce((total, x) => total + x.minutes, 0)
  const goalsAtRisk = next.goals.filter((g) => !g.fits && !current.goals.some((c) => c.taskId === g.taskId && !c.fits)).map((g) => g.task)
  return {
    feasibility: `${current.status} → ${next.status}`,
    daysThatChange: days,
    totalStudy: `${formatDuration(current.totals.plannedStudyMinutes)} → ${formatDuration(next.totals.plannedStudyMinutes)}`,
    tasksThatMove,
    todayStudy: `${formatDuration(sum(todayBefore))} → ${formatDuration(sum(todayAfter))}`,
    workMovedOffToday: formatDuration(movedFromToday),
    tomorrowStudy: `${formatDuration(sum(tomorrowBefore))} → ${formatDuration(sum(tomorrowAfter))}`,
    goalsThatNoLongerFit: goalsAtRisk,
    newWarnings: next.warnings.filter((w) => !current.warnings.includes(w)),
  }
}

function sessionsKey(day: PlanningScenario["days"][number] | undefined) {
  return (day?.sessions ?? []).map((s) => `${s.taskId}@${s.startTime}`).join(",")
}

// ---- Corrections to personalization (after Confirm).

export const correctPersonalization = defineTool({
  name: "correctPersonalization",
  description:
    "Propose a correction to how Student OS personalizes planning, when the student asks: their preferred study times (\"I actually prefer studying at night\": explicit, beats anything learned), their planning mode, switching learned estimates / study times / pacing on or off (\"stop adapting my task durations\"), turning off one learned pattern (\"don't use this pattern\": an insight id from getLearnedPatterns) or turning it back on, or always using their own estimate for a task (\"this estimate is wrong\"). The student confirms before it's saved. Only include what they asked for.",
  input: z
    .object({
      preferredPeriods: z.array(z.enum(studyPeriods)).max(4).optional().describe("The full list of times the student prefers (empty = no preference)."),
      planningMode: z.enum(planningModesAll).optional(),
      useEstimates: z.boolean().optional(),
      useStudyTimes: z.boolean().optional(),
      useWorkload: z.boolean().optional(),
      dismissPattern: z.string().max(80).optional().describe("An insight id from getLearnedPatterns (e.g. avoid:night)."),
      restorePattern: z.string().max(80).optional(),
      useOwnEstimateFor: taskRefInput.optional(),
    })
    .strict(),
  run(ctx, input) {
    const { useOwnEstimateFor: ref, ...rest } = input
    let taskId: string | undefined
    if (ref) {
      const found = resolveTask(ctx.data.tasks, ref)
      if ("ambiguous" in found) {
        return { result: { status: "ambiguous", instruction: "Ask which task. Change nothing.", options: found.ambiguous.map((t) => taskBrief(ctx, t)) } }
      }
      if ("notFound" in found) return { result: { status: "not_found", problem: "No open task matches that in Student OS." } }
      taskId = found.found.id
    }
    const pattern = /^[a-z]+(:[a-z0-9-]+){0,3}$/i
    if ((rest.dismissPattern && !pattern.test(rest.dismissPattern)) || (rest.restorePattern && !pattern.test(rest.restorePattern))) {
      return { result: { status: "not_possible", problem: "Student OS hasn't learned that pattern." } }
    }
    const check = prepareAction(ctx, { kind: "update-personalization", changes: { ...rest, ...(taskId ? { useOwnEstimateFor: taskId } : {}) } })
    if (!check.ok) return { result: { status: "not_possible", problem: check.problem } }
    return {
      focusTaskId: taskId,
      pending: check.pending,
      result: {
        status: "needs_confirmation",
        summary: check.pending.summary,
        instruction: "Nothing is saved yet. The student sees Confirm / Cancel buttons. Say in one short sentence what will change and ask them to confirm.",
      },
    }
  },
})

export const planningTools = [getPlanningContext, explainPlan, simulatePlanChange, generatePlanningScenarios, findAvailableTimes, applyConfirmedPlanChange, correctPersonalization]
export const planningActionTools = [applyConfirmedPlanChange, correctPersonalization]
