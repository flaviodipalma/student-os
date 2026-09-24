import { toMinutes } from "@/lib/events"
import { addDays, daysBetween, formatDuration, fromDateKey } from "@/lib/format"
import type { LearnedPlanning } from "@/lib/planner"
import type { Course, LearningSettings, StudySessionRecord, Task, TaskType } from "@/lib/types"
import { recencyWeight, robustSummary, weightedMedian, type Weighted } from "./stats"

// Adaptive planning ("AdaptivePlanningService"): what Student OS learns from one
// student's own planning history, and how it feeds the deterministic Planner.
//
//   history (tasks + study sessions) -> analyzeHistory -> AdaptivePlanningContext
//     -> learnedPlanning(context) -> PlannerInput.learned -> Planner (soft only)
//     -> insights / explanations (Settings, "Why this?", the Assistant)
//
// Learned values never replace what the student entered: the task keeps its own
// estimate; the Planner is given a learned one next to it, with the reason.
// Nothing here can make a schedule impossible: estimates change how much time
// the Planner looks for, and times of day only change which free time it uses
// first. Pure and deterministic; only this student's data goes in.

export type Confidence = "low" | "medium" | "high"
export type EvidenceGroup = "course-type" | "course" | "type" | "all"

export type LearnedEstimate = {
  taskId: string
  // What the student entered (null = no estimate).
  userMinutes: number | null
  // What the Planner uses.
  minutes: number
  confidence: Confidence
  basis: { group: EvidenceGroup; label: string; tasks: number; typicalRatio: number | null; typicalMinutes: number | null }
  // Short, for "Why this?": "Adjusted to 1h 25m from your past CSC215 lab reports".
  reason: string
  // Full: "Your last 5 CSC215 lab reports took about 1.4× your estimates."
  explanation: string
}

export type StudyPeriodKey = "morning" | "afternoon" | "evening" | "night"
export type PeriodStats = {
  period: StudyPeriodKey
  label: string
  sessions: number
  completed: number
  missed: number
  skipped: number
  moved: number
  completionRate: number
}

export type Insight = { id: string; kind: "estimate" | "time-of-day" | "workload"; text: string; confidence: Confidence }

export type AdaptivePlanningContext = {
  enabled: boolean
  // Since when history counts (after "Reset learning"), or null.
  since: string | null
  estimates: Record<string, LearnedEstimate>
  periods: PeriodStats[]
  // Times the Planner uses last (soft), with why.
  avoid: { period: StudyPeriodKey; start: number; end: number; reason: string; confidence: Confidence }[]
  // Planned vs completed study on days with study on the calendar.
  workload: { days: number; typicalPlannedMinutes: number; typicalCompletedMinutes: number } | null
  // Finished tasks with logged work that the estimates learn from.
  observations: number
  // Only shown when there's enough history.
  insights: Insight[]
}

export type BehaviorHistory = {
  tasks: Task[]
  courses: Course[]
  studySessions: StudySessionRecord[]
  learning?: LearningSettings
  fallbackEstimateMinutes?: number
}

// The rules, in one place.
export const ADAPTIVE_RULES = {
  // Observations needed for a group (course + type, course, type) / for all tasks.
  minGroup: 3,
  minAll: 5,
  // At most this many recent observations per group.
  maxPerGroup: 20,
  // Estimate factor limits (after shrinking toward the student's estimate).
  minFactor: 0.6,
  maxFactor: 1.8,
  // Changes smaller than this aren't worth making.
  minChange: 0.1,
  // Shrinking: factor = 1 + (typical − 1) × n / (n + shrink).
  shrink: 3,
  // Logged work counts only if it's at least this share of the estimate (else it
  // was probably not all logged) and at least this long.
  minLoggedShare: 0.25,
  minLoggedMinutes: 15,
  // Times of day: enough sessions, a poor record, and a clearly better time.
  minPeriodSessions: 6,
  poorRate: 0.4,
  betterBy: 0.3,
  // Workload: days looked at, and days needed.
  workloadDays: 28,
  minWorkloadDays: 5,
}

export const PERIODS: { key: StudyPeriodKey; label: string; start: number; end: number }[] = [
  { key: "morning", label: "morning", start: 5 * 60, end: 12 * 60 },
  { key: "afternoon", label: "afternoon", start: 12 * 60, end: 17 * 60 },
  { key: "evening", label: "evening", start: 17 * 60, end: 21 * 60 },
  { key: "night", label: "late night", start: 21 * 60, end: 24 * 60 },
]

export function periodOf(time: string): StudyPeriodKey {
  const minutes = toMinutes(time)
  return PERIODS.find((p) => minutes >= p.start && minutes < p.end)?.key ?? "night"
}

const EMPTY = (learning: LearningSettings | undefined): AdaptivePlanningContext => ({
  enabled: learning?.enabled ?? true,
  since: learning?.since ?? null,
  estimates: {},
  periods: [],
  avoid: [],
  workload: null,
  observations: 0,
  insights: [],
})

export function analyzeHistory(history: BehaviorHistory, today: string): AdaptivePlanningContext {
  const context = EMPTY(history.learning)
  if (!context.enabled) return context
  const since = context.since ?? "0000-00-00"
  const sessions = history.studySessions.filter((s) => s.date >= since && s.date < today)

  const observations = observe(history.tasks, sessions, today)
  context.observations = observations.length
  const labels = groupLabels(history.courses)
  for (const task of history.tasks) {
    if (task.status === "completed") continue
    const learned = learnEstimate(task, observations, labels, history.fallbackEstimateMinutes ?? 60)
    if (learned) context.estimates[task.id] = learned
  }
  context.periods = periodStats(sessions, since)
  context.avoid = avoidedPeriods(context.periods)
  context.workload = workload(sessions, today, since)
  context.insights = insights(context, observations, labels)
  return context
}

// What the Planner gets: learned estimates and times to use last.
export function learnedPlanning(context: AdaptivePlanningContext): LearnedPlanning | undefined {
  if (!context.enabled) return undefined
  const estimates = Object.fromEntries(Object.values(context.estimates).map((e) => [e.taskId, { minutes: e.minutes, reason: e.reason }]))
  const avoidTimes = context.avoid.map(({ start, end, reason }) => ({ start, end, reason }))
  if (Object.keys(estimates).length === 0 && avoidTimes.length === 0) return undefined
  return { estimates, avoidTimes }
}

// ---- Estimates -------------------------------------------------------------------

type Observation = { courseId: string; type: TaskType; estimate: number | null; actual: number; weight: number; ageDays: number; lastDate: string }

// Finished tasks with the time actually logged on them (completed study
// sessions, partly done ones counting the minutes worked).
function observe(tasks: Task[], sessions: StudySessionRecord[], today: string): Observation[] {
  const out: Observation[] = []
  for (const task of tasks) {
    if (task.status !== "completed") continue
    const done = sessions.filter((s) => s.taskId === task.id && s.status === "completed")
    if (done.length === 0) continue
    const actual = done.reduce((sum, s) => sum + worked(s), 0)
    if (actual < ADAPTIVE_RULES.minLoggedMinutes) continue
    const lastDate = done.reduce((last, s) => (s.date > last ? s.date : last), done[0].date)
    const ageDays = daysBetween(fromDateKey(lastDate), fromDateKey(today))
    const estimate = task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : null
    out.push({
      courseId: task.courseId,
      type: task.type,
      // Logged time far below the estimate probably wasn't all logged: not a ratio.
      estimate: estimate && actual >= ADAPTIVE_RULES.minLoggedShare * estimate ? estimate : null,
      actual,
      weight: recencyWeight(ageDays),
      ageDays,
      lastDate,
    })
  }
  return out
}

const lengthOf = (s: StudySessionRecord) => toMinutes(s.endTime) - toMinutes(s.startTime)

function worked(s: StudySessionRecord): number {
  const length = lengthOf(s)
  return s.completedMinutes ? Math.min(s.completedMinutes, length) : length
}

type Labels = { courseCode: (courseId: string) => string }
function groupLabels(courses: Course[]): Labels {
  const codes = new Map(courses.map((c) => [c.id, c.code]))
  return { courseCode: (id) => codes.get(id) ?? "this course" }
}

const plural: Record<TaskType, string> = {
  assignment: "assignments",
  exam: "exam preps",
  quiz: "quiz preps",
  project: "projects",
  paper: "papers",
  reading: "readings",
  lab: "lab reports",
  presentation: "presentations",
  study: "study tasks",
  other: "other tasks",
}

function groupLabel(group: EvidenceGroup, task: Pick<Task, "courseId" | "type">, labels: Labels): string {
  const code = labels.courseCode(task.courseId)
  return group === "course-type" ? `${code} ${plural[task.type]}` : group === "course" ? `${code} tasks` : group === "type" ? plural[task.type] : "tasks"
}

// The most specific group with enough history: course + type, course, type, all.
function evidence(task: Task, observations: Observation[], use: (o: Observation) => boolean) {
  const groups: [EvidenceGroup, (o: Observation) => boolean, number][] = [
    ["course-type", (o) => o.courseId === task.courseId && o.type === task.type, ADAPTIVE_RULES.minGroup],
    ["course", (o) => o.courseId === task.courseId, ADAPTIVE_RULES.minGroup],
    ["type", (o) => o.type === task.type, ADAPTIVE_RULES.minGroup],
    ["all", () => true, ADAPTIVE_RULES.minAll],
  ]
  for (const [group, match, min] of groups) {
    const found = observations
      .filter((o) => use(o) && match(o))
      .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0))
      .slice(0, ADAPTIVE_RULES.maxPerGroup)
    if (found.length >= min) return { group, found }
  }
  return null
}

export function confidenceOf(tasks: number, spread: number, newestAgeDays: number): Confidence {
  // Spread = median distance from the typical value, as a share of it.
  const level: Confidence = tasks >= 12 && spread <= 0.15 ? "high" : tasks >= 5 && spread <= 0.25 ? "medium" : "low"
  // Old history only: one level less sure.
  if (newestAgeDays > 180) return level === "high" ? "medium" : "low"
  return level
}

const round5 = (m: number) => Math.round(m / 5) * 5

function learnEstimate(task: Task, observations: Observation[], labels: Labels, fallback: number): LearnedEstimate | null {
  const user = task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : null
  const newestAge = (found: Observation[]) => Math.min(...found.map((o) => o.ageDays))

  if (user) {
    // How much longer (or shorter) similar tasks took than the student's own estimates.
    const found = evidence(task, observations, (o) => o.estimate !== null)
    if (!found) return null
    const summary = robustSummary(found.found.map((o): Weighted => ({ value: o.actual / o.estimate!, weight: o.weight })))
    const n = summary.kept.length
    const shrunk = 1 + (summary.median - 1) * (n / (n + ADAPTIVE_RULES.shrink))
    const factor = Math.min(ADAPTIVE_RULES.maxFactor, Math.max(ADAPTIVE_RULES.minFactor, shrunk))
    if (Math.abs(factor - 1) < ADAPTIVE_RULES.minChange) return null
    const minutes = Math.max(15, round5(user * factor))
    if (minutes === user) return null
    const confidence = confidenceOf(n, summary.spread, newestAge(found.found))
    const label = groupLabel(found.group, task, labels)
    const ratio = Math.round(summary.median * 10) / 10
    return {
      taskId: task.id,
      userMinutes: user,
      minutes,
      confidence,
      basis: { group: found.group, label, tasks: n, typicalRatio: ratio, typicalMinutes: null },
      reason:
        confidence === "low"
          ? `Adjusted a little from your past ${label} (still learning your pattern)`
          : `Adjusted to ${formatDuration(minutes)} from your past ${label}`,
      explanation: `Your last ${n} ${label} took about ${ratio}× your estimates, so the Planner plans ${formatDuration(minutes)} instead of your ${formatDuration(user)}.${
        confidence === "low" ? " There isn't much history yet, so this is a small adjustment." : ""
      }`,
    }
  }

  // No estimate: how long similar tasks actually took (instead of the fallback).
  const found = evidence(task, observations, () => true)
  if (!found) return null
  const summary = robustSummary(found.found.map((o): Weighted => ({ value: o.actual, weight: o.weight })))
  const n = summary.kept.length
  const typical = round5(summary.median)
  const minutes = Math.min(600, Math.max(15, round5(fallback + (summary.median - fallback) * (n / (n + ADAPTIVE_RULES.shrink)))))
  if (minutes === fallback) return null
  const confidence = confidenceOf(n, summary.spread, newestAge(found.found))
  const label = groupLabel(found.group, task, labels)
  return {
    taskId: task.id,
    userMinutes: null,
    minutes,
    confidence,
    basis: { group: found.group, label, tasks: n, typicalRatio: null, typicalMinutes: typical },
    reason: `No estimate: planned as ${formatDuration(minutes)} from your past ${label}`,
    explanation: `This task has no estimate. Your last ${n} ${label} took about ${formatDuration(typical)}, so the Planner plans ${formatDuration(minutes)}.${
      confidence === "low" ? " There isn't much history yet; adding your own estimate helps." : ""
    }`,
  }
}

// ---- Times of day -------------------------------------------------------------------

function periodStats(sessions: StudySessionRecord[], since: string): PeriodStats[] {
  const stats = new Map(PERIODS.map((p) => [p.key, { period: p.key, label: p.label, sessions: 0, completed: 0, missed: 0, skipped: 0, moved: 0, completionRate: 0 }]))
  for (const s of sessions) {
    const at = stats.get(periodOf(s.startTime))!
    if (s.status === "completed") at.completed++
    else if (s.status === "skipped") at.skipped++
    // Still "scheduled" on a past day: it wasn't done.
    else at.missed++
    // Moved away from where it was first planned.
    if ((s.rescheduleCount ?? 0) > 0 && s.firstStartTime && (s.firstDate ?? s.date) >= since) stats.get(periodOf(s.firstStartTime))!.moved++
  }
  return [...stats.values()].map((p) => {
    const sessions = p.completed + p.missed + p.skipped + p.moved
    return { ...p, sessions, completionRate: sessions ? Math.round((p.completed / sessions) * 100) / 100 : 0 }
  })
}

function avoidedPeriods(periods: PeriodStats[]): AdaptivePlanningContext["avoid"] {
  const r = ADAPTIVE_RULES
  return periods
    .filter(
      (p) =>
        p.sessions >= r.minPeriodSessions &&
        p.completionRate <= r.poorRate &&
        periods.some((other) => other !== p && other.sessions >= 4 && other.completionRate >= p.completionRate + r.betterBy)
    )
    .map((p) => {
      const range = PERIODS.find((x) => x.key === p.period)!
      const confidence: Confidence = p.sessions >= 15 ? "high" : p.sessions >= 8 ? "medium" : "low"
      return { period: p.period, start: range.start, end: range.end, reason: `Not in the ${p.label}: you often miss or move sessions then`, confidence }
    })
}

// ---- Workload ---------------------------------------------------------------------

function workload(sessions: StudySessionRecord[], today: string, since: string): AdaptivePlanningContext["workload"] {
  const from = [addDays(today, -ADAPTIVE_RULES.workloadDays), since].sort()[1]
  const days = new Map<string, { planned: number; completed: number }>()
  for (const s of sessions) {
    if (s.date < from || s.status === "skipped") continue
    const day = days.get(s.date) ?? { planned: 0, completed: 0 }
    day.planned += lengthOf(s)
    if (s.status === "completed") day.completed += worked(s)
    days.set(s.date, day)
  }
  const busy = [...days.values()].filter((d) => d.planned >= 60)
  if (busy.length < ADAPTIVE_RULES.minWorkloadDays) return null
  const typical = (values: number[]) => round5(weightedMedian(values.map((value) => ({ value, weight: 1 }))))
  return { days: busy.length, typicalPlannedMinutes: typical(busy.map((d) => d.planned)), typicalCompletedMinutes: typical(busy.map((d) => d.completed)) }
}

// ---- Insights (only with enough history) ---------------------------------------------

function insights(context: AdaptivePlanningContext, observations: Observation[], labels: Labels): Insight[] {
  const out: Insight[] = []
  // Estimates, by course + type and by type: clear differences with at least 5 tasks.
  const groups = new Map<string, { label: string; values: Weighted[]; newest: number }>()
  for (const o of observations) {
    if (o.estimate === null) continue
    for (const [key, label] of [
      [`ct:${o.courseId}:${o.type}`, groupLabel("course-type", o, labels)],
      [`t:${o.type}`, groupLabel("type", o, labels)],
    ]) {
      const g = groups.get(key) ?? { label, values: [], newest: Infinity }
      g.values.push({ value: o.actual / o.estimate, weight: o.weight })
      g.newest = Math.min(g.newest, o.ageDays)
      groups.set(key, g)
    }
  }
  const covered = new Set<string>()
  for (const [key, g] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (g.values.length < 5) continue
    const s = robustSummary(g.values)
    const confidence = confidenceOf(s.kept.length, s.spread, g.newest)
    if (confidence === "low" || Math.abs(s.median - 1) < 0.2) continue
    // A type-level insight that only repeats a course-level one isn't shown.
    const direction = s.median > 1 ? "longer" : "shorter"
    if (key.startsWith("t:") && covered.has(`${key.slice(2)}:${direction}`)) continue
    if (key.startsWith("ct:")) covered.add(`${key.split(":")[2]}:${direction}`)
    const ratio = Math.round(s.median * 10) / 10
    out.push({
      id: `estimate:${key}`,
      kind: "estimate",
      confidence,
      text:
        s.median > 1
          ? `${capitalize(g.label)} usually take you longer than you estimate (about ${ratio}×, from ${s.kept.length} tasks).`
          : `${capitalize(g.label)} usually take you less time than you estimate (about ${ratio}×, from ${s.kept.length} tasks).`,
    })
  }
  const best = [...context.periods].filter((p) => p.sessions >= ADAPTIVE_RULES.minPeriodSessions && p.completionRate >= 0.7).sort((a, b) => b.completionRate - a.completionRate)[0]
  if (best) {
    out.push({
      id: `time:${best.period}`,
      kind: "time-of-day",
      confidence: best.sessions >= 15 ? "high" : best.sessions >= 8 ? "medium" : "low",
      text: `You finish most study sessions in the ${best.label} (${best.completed} of ${best.sessions}).`,
    })
  }
  for (const avoid of context.avoid) {
    const p = context.periods.find((x) => x.period === avoid.period)!
    out.push({
      id: `avoid:${avoid.period}`,
      kind: "time-of-day",
      confidence: avoid.confidence,
      text: `${capitalize(p.label)} sessions are often missed or moved (${p.sessions - p.completed} of ${p.sessions}), so the Planner uses other free time first when it can.`,
    })
  }
  const w = context.workload
  if (w && w.typicalCompletedMinutes < 0.8 * w.typicalPlannedMinutes) {
    out.push({
      id: "workload",
      kind: "workload",
      confidence: w.days >= 14 ? "high" : w.days >= 8 ? "medium" : "low",
      text: `On days with study on your calendar, you usually finish about ${formatDuration(w.typicalCompletedMinutes)} of ${formatDuration(w.typicalPlannedMinutes)} planned. Your daily limit is yours to change in Settings.`,
    })
  }
  return out
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
