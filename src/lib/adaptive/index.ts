import { toMinutes } from "@/lib/events"
import { addDays, daysBetween, formatDuration, fromDateKey } from "@/lib/format"
import type { LearnedPlanning } from "@/lib/planner"
import { DEFAULT_LEARNING_SETTINGS, type Course, type LearningSettings, type StudyPeriod, type StudySessionRecord, type Task, type TaskType } from "@/lib/types"
import { buildProfile, type StudentPlanningProfile } from "./profile"
import { recencyWeight, robustSummary, weightedMedian, type Weighted } from "./stats"

// Adaptive planning ("AdaptivePlanningService"): what Student OS learns from one
// student's own planning history, and how it feeds the deterministic Planner.
//
//   history (tasks + study sessions) -> analyzeHistory -> AdaptivePlanningContext
//     (learned estimates, times of day, pacing, insights, StudentPlanningProfile)
//     -> plannerInputFor -> PlannerInput.learned -> Planner (soft only)
//     -> explanations (Settings, "Why this?", the Assistant)
//
// Three kinds of information stay separate: the student's EXPLICIT choices
// (settings, mode, preferred times: always win), what was OBSERVED (counts,
// rates, typical values, each with confidence and sample size) and what the
// Planner INFERS from it (use this time last, plan this long, pace the day).
// The student can switch each learned signal off, turn off a single pattern, or
// keep their own estimate for a task.
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

export type StudyPeriodKey = StudyPeriod
export type PeriodStats = {
  period: StudyPeriodKey
  label: string
  sessions: number
  completed: number
  missed: number
  skipped: number
  moved: number
  // Recent sessions count more (half-life 45 days), smoothed toward the overall rate.
  completionRate: number
  // How much recent evidence there is (sessions, weighted by recency).
  weight: number
}

export type Insight = {
  // Also the pattern id for "Don't use this" (e.g. "avoid:night", "estimate:t:lab", "workload").
  id: string
  kind: "estimate" | "time-of-day" | "workload"
  text: string
  confidence: Confidence
  observations: number
  // Does the Planner act on it (and can it be turned off)?
  affectsPlanning: boolean
  // Turned off by the student: shown, but not used.
  dismissed: boolean
}

// A soft daily study target: non-urgent work stops there; urgent work can still
// use the student's full daily limit.
export type Pacing = { softMinutes: number; reason: string; confidence: Confidence }

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
  // Learned pacing (from workload), when it's clear enough and switched on.
  pacing: Pacing | null
  // Finished tasks with logged work that the estimates learn from.
  observations: number
  // Only shown when there's enough history.
  insights: Insight[]
  // Everything learned, structured, with confidence and evidence.
  profile: StudentPlanningProfile
  // The student's settings this was computed with.
  settings: LearningSettings
}

export type BehaviorHistory = {
  tasks: Task[]
  courses: Course[]
  studySessions: StudySessionRecord[]
  learning?: Partial<LearningSettings>
  fallbackEstimateMinutes?: number
  // The student's daily study limit (pacing never goes above it).
  dailyLimitMinutes?: number
}

// The rules, in one place.
export const ADAPTIVE_RULES = {
  // Observations needed for a group (course + type, course, type) / for all tasks.
  minGroup: 3,
  minAll: 5,
  // …from at least this many kinds of task (course + type).
  minKindsForAll: 3,
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
  // Only the last `habitDays` count, newer ones more (half-life `habitHalfLife`),
  // and rates are smoothed toward the student's overall rate (`habitPrior`
  // sessions' worth), so a few odd days don't flip anything.
  minPeriodSessions: 6,
  poorRate: 0.4,
  betterBy: 0.3,
  habitDays: 90,
  habitHalfLife: 45,
  habitPrior: 2,
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

function emptyContext(settings: LearningSettings, today: string): AdaptivePlanningContext {
  return {
    enabled: settings.enabled,
    since: settings.since,
    estimates: {},
    periods: [],
    avoid: [],
    workload: null,
    pacing: null,
    observations: 0,
    insights: [],
    profile: buildProfile({ settings, today }),
    settings,
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

// History that can't be right (bad times, zero-length or day-long sessions,
// sessions for tasks that don't exist) is left out rather than trusted.
function cleanSessions(sessions: StudySessionRecord[], taskIds: Set<string>): StudySessionRecord[] {
  return sessions.filter((s) => {
    if (!taskIds.has(s.taskId) || !DATE.test(s.date) || !TIME.test(s.startTime) || !TIME.test(s.endTime)) return false
    const length = toMinutes(s.endTime) - toMinutes(s.startTime)
    if (length <= 0 || length > 16 * 60) return false
    if (s.completedMinutes !== null && s.completedMinutes !== undefined && !(s.completedMinutes >= 0)) return false
    if (s.firstStartTime && !TIME.test(s.firstStartTime)) return false
    return true
  })
}

export function analyzeHistory(history: BehaviorHistory, today: string): AdaptivePlanningContext {
  const settings: LearningSettings = { ...DEFAULT_LEARNING_SETTINGS, ...history.learning }
  const context = emptyContext(settings, today)
  if (!settings.enabled) return context
  const since = settings.since ?? "0000-00-00"
  const tasks = history.tasks.filter((t) => t && typeof t.id === "string")
  const all = cleanSessions(history.studySessions, new Set(tasks.map((t) => t.id))).filter((s) => s.date >= since && s.date < today)
  const habitFrom = [addDays(today, -ADAPTIVE_RULES.habitDays), since].sort()[1]
  const recent = all.filter((s) => s.date >= habitFrom)

  const observations = observe(tasks, all, today)
  context.observations = observations.length
  const labels = groupLabels(history.courses)
  const dismissed = new Set(settings.dismissedPatterns)
  const learningOn = settings.planningMode !== "custom"

  // Learned estimates: switched on, not "custom", not turned off for this kind
  // of task, and not a task where the student keeps their own estimate.
  if (settings.useEstimates && learningOn) {
    const own = new Set(settings.ownEstimateTaskIds)
    for (const task of tasks) {
      if (task.status === "completed" || own.has(task.id)) continue
      if (dismissed.has(`estimate:ct:${task.courseId}:${task.type}`) || dismissed.has(`estimate:t:${task.type}`)) continue
      const learned = learnEstimate(task, observations, labels, history.fallbackEstimateMinutes ?? 60)
      if (learned) context.estimates[task.id] = learned
    }
  }

  context.periods = periodStats(recent, since, today)
  const poorTimes = avoidedPeriods(context.periods)
  // Times the student says they prefer are never "used last" (explicit wins).
  context.avoid =
    settings.useStudyTimes && learningOn
      ? poorTimes.filter((a) => !dismissed.has(`avoid:${a.period}`) && !settings.preferredPeriods.includes(a.period))
      : []
  context.workload = workload(all, today, since)
  context.pacing = settings.useWorkload && learningOn && !dismissed.has("workload") ? pacingFrom(context.workload, history.dailyLimitMinutes) : null
  context.insights = insights(context, observations, labels, poorTimes, settings)
  context.profile = buildProfile({
    settings,
    today,
    tasks,
    sessions: recent,
    allSessions: all,
    observations: observations.map((o) => ({ ...o, label: groupLabel("course-type", o, labels), typeLabel: groupLabel("type", o, labels) })),
    periods: context.periods,
    poorTimes,
    workload: context.workload,
    pacing: context.pacing,
    estimatesInUse: Object.keys(context.estimates).length,
    avoidInUse: context.avoid,
  })
  return context
}
// What the Planner gets. Preferred times are the student's explicit choice, so
// they apply even with learning off; everything else is learned and only there
// when switched on.
export function learnedPlanning(context: AdaptivePlanningContext): LearnedPlanning | undefined {
  const preferTimes = context.settings.preferredPeriods.map((key) => {
    const p = PERIODS.find((x) => x.key === key)!
    return { start: p.start, end: p.end, reason: `In the ${p.label}: the time you said you prefer` }
  })
  const estimates = Object.fromEntries(Object.values(context.estimates).map((e) => [e.taskId, { minutes: e.minutes, reason: e.reason }]))
  const avoidTimes = context.avoid.map(({ start, end, reason }) => ({ start, end, reason }))
  const learned: LearnedPlanning = {
    ...(Object.keys(estimates).length ? { estimates } : {}),
    ...(avoidTimes.length ? { avoidTimes } : {}),
    ...(preferTimes.length ? { preferTimes } : {}),
    ...(context.pacing ? { pacing: { softMinutes: context.pacing.softMinutes, reason: context.pacing.reason } } : {}),
  }
  return Object.keys(learned).length ? learned : undefined
}

// ---- Estimates -------------------------------------------------------------------

export type Observation = { courseId: string; type: TaskType; estimate: number | null; actual: number; weight: number; ageDays: number; lastDate: string; sessions: number }

// Finished tasks with the time actually logged on them (completed study
// sessions, partly done ones counting the minutes worked).
function observe(tasks: Task[], sessions: StudySessionRecord[], today: string): Observation[] {
  const out: Observation[] = []
  // Completed sessions by task (one pass, so a semester of history stays fast).
  const byTask = new Map<string, StudySessionRecord[]>()
  for (const s of sessions) if (s.status === "completed") byTask.set(s.taskId, [...(byTask.get(s.taskId) ?? []), s])
  for (const task of tasks) {
    if (task.status !== "completed") continue
    const done = byTask.get(task.id) ?? []
    if (done.length === 0) continue
    const actual = done.reduce((sum, s) => sum + worked(s), 0)
    if (actual < ADAPTIVE_RULES.minLoggedMinutes) continue
    const lastDate = done.reduce((last, s) => (s.date > last ? s.date : last), done[0].date)
    const ageDays = daysBetween(fromDateKey(lastDate), fromDateKey(today))
    const estimate = task.estimateMinutes && Number.isFinite(task.estimateMinutes) && task.estimateMinutes > 0 ? task.estimateMinutes : null
    out.push({
      courseId: task.courseId,
      type: task.type,
      // Logged time far below the estimate probably wasn't all logged: not a ratio.
      estimate: estimate && actual >= ADAPTIVE_RULES.minLoggedShare * estimate ? estimate : null,
      actual,
      weight: recencyWeight(ageDays),
      ageDays,
      lastDate,
      sessions: done.length,
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
    // "All tasks" only speaks for other kinds of task when it covers several
    // kinds itself (8 CSC215 lab reports say nothing about a Psychology exam).
    if (group === "all" && kindsIn(found) < ADAPTIVE_RULES.minKindsForAll) continue
    if (found.length >= min) return { group, found }
  }
  return null
}

// The levels of evidence for a task's ratio, broadest first, ending with the
// group the estimate is based on: all -> (course or type) -> course + type.
function ratioChain(task: Task, group: EvidenceGroup, observations: Observation[]) {
  const withRatio = observations.filter((o) => o.estimate !== null)
  // The chosen group uses its most recent tasks; broader levels use all of
  // theirs (recency-weighted), so a mix can't hide behind a sample.
  const level = (match: (o: Observation) => boolean, cap = Infinity) => {
    const items = withRatio
      .filter(match)
      .sort((a, b) => (a.lastDate < b.lastDate ? 1 : a.lastDate > b.lastDate ? -1 : 0))
      .slice(0, cap)
    if (items.length === 0) return null
    const s = robustSummary(items.map((o): Weighted => ({ value: o.actual / o.estimate!, weight: o.weight })))
    return { median: s.median, n: s.kept.length, used: items.length, total: withRatio.filter(match).length, spread: s.spread, newest: Math.min(...items.map((o) => o.ageDays)) }
  }
  const cap = (g: EvidenceGroup) => (g === group ? ADAPTIVE_RULES.maxPerGroup : Infinity)
  const all = level(() => true, cap("all"))
  const course = level((o) => o.courseId === task.courseId, cap("course"))
  const type = level((o) => o.type === task.type, cap("type"))
  const specific = level((o) => o.courseId === task.courseId && o.type === task.type, cap("course-type"))
  const r = ADAPTIVE_RULES
  const middle = course && course.total >= r.minGroup ? course : type && type.total >= r.minGroup ? type : null
  const chain =
    group === "course-type" ? [all, middle, specific] : group === "course" ? [all, course] : group === "type" ? [all, type] : [all]
  const out: { median: number; n: number; used: number; total: number; spread: number; newest: number }[] = []
  for (const [i, lvl] of chain.entries()) {
    if (!lvl) continue
    const isLast = i === chain.length - 1
    const next = chain.slice(i + 1).find(Boolean)
    const enough = lvl === all ? lvl.total >= r.minAll && kindsIn(withRatio) >= r.minKindsForAll : lvl.total >= r.minGroup
    // Broader levels only when they add tasks and behave like one group (few
    // outliers, not widely spread: a mix of slow assignments and fast readings
    // says nothing about either); the chosen group always counts.
    const coherent = lvl.n >= 0.75 * lvl.used && lvl.spread <= 0.35
    if (isLast || (enough && coherent && (!next || lvl.total > next.total))) out.push(lvl)
  }
  return out
}

const kindsIn = (items: Observation[]) => new Set(items.map((o) => `${o.courseId}:${o.type}`)).size

export function confidenceOf(tasks: number, spread: number, newestAgeDays: number): Confidence {
  // Spread = median distance from the typical value, as a share of it.
  const level: Confidence = tasks >= 12 && spread <= 0.15 ? "high" : tasks >= 5 && spread <= 0.25 ? "medium" : "low"
  // Old history only: one level less sure.
  if (newestAgeDays > 180) return level === "high" ? "medium" : "low"
  return level
}

const round5 = (m: number) => Math.round(m / 5) * 5

function learnEstimate(task: Task, observations: Observation[], labels: Labels, fallback: number): LearnedEstimate | null {
  const user = task.estimateMinutes && Number.isFinite(task.estimateMinutes) && task.estimateMinutes > 0 ? task.estimateMinutes : null
  const newestAge = (found: Observation[]) => Math.min(...found.map((o) => o.ageDays))

  if (user) {
    // How much longer (or shorter) similar tasks took than the student's own estimates.
    const found = evidence(task, observations, (o) => o.estimate !== null)
    if (!found) return null
    const summary = robustSummary(found.found.map((o): Weighted => ({ value: o.actual / o.estimate!, weight: o.weight })))
    const n = summary.kept.length
    // Hierarchical shrinking: start from 1× (no change), move toward all tasks,
    // then the course (or type), then the most specific group, each by
    // n / (n + shrink). A broader level only counts if it has more tasks than
    // the level below it (the same tasks are never counted twice).
    const chain = ratioChain(task, found.group, observations)
    const shrunk = chain.reduce((base, level) => base + (level.median - base) * (level.n / (level.n + ADAPTIVE_RULES.shrink)), 1)
    const factor = Math.min(ADAPTIVE_RULES.maxFactor, Math.max(ADAPTIVE_RULES.minFactor, shrunk))
    if (Math.abs(factor - 1) < ADAPTIVE_RULES.minChange) return null
    const minutes = Math.max(15, round5(user * factor))
    if (minutes === user) return null
    // As sure as the best-supported level it rests on.
    const order: Confidence[] = ["low", "medium", "high"]
    const confidence = chain
      .map((level) => confidenceOf(level.n, level.spread, level.newest))
      .reduce((best, c) => (order.indexOf(c) > order.indexOf(best) ? c : best), confidenceOf(n, summary.spread, newestAge(found.found)))
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

function periodStats(sessions: StudySessionRecord[], since: string, today: string): PeriodStats[] {
  const r = ADAPTIVE_RULES
  const weight = (date: string) => 0.5 ** (Math.max(0, daysBetween(fromDateKey(date), fromDateKey(today))) / r.habitHalfLife)
  const stats = new Map(
    PERIODS.map((p) => [p.key, { period: p.key, label: p.label, sessions: 0, completed: 0, missed: 0, skipped: 0, moved: 0, completionRate: 0, wDone: 0, wAll: 0 }])
  )
  for (const s of sessions) {
    const at = stats.get(periodOf(s.startTime))!
    const w = weight(s.date)
    at.wAll += w
    if (s.status === "completed") {
      at.completed++
      at.wDone += w
    } else if (s.status === "skipped") at.skipped++
    // Still "scheduled" on a past day: it wasn't done.
    else at.missed++
    // Moved away from where it was first planned.
    const first = s.firstDate ?? s.date
    if ((s.rescheduleCount ?? 0) > 0 && s.firstStartTime && first >= since) {
      const from = stats.get(periodOf(s.firstStartTime))!
      from.moved++
      from.wAll += weight(first)
    }
  }
  const values = [...stats.values()]
  const wDone = values.reduce((sum, p) => sum + p.wDone, 0)
  const wAll = values.reduce((sum, p) => sum + p.wAll, 0)
  const overall = wAll > 0 ? wDone / wAll : 0.5
  return values.map(({ wDone: done, wAll: all, ...p }) => {
    const sessions = p.completed + p.missed + p.skipped + p.moved
    // Recent sessions count more; smoothed toward the overall rate.
    const rate = sessions ? (done + r.habitPrior * overall) / (all + r.habitPrior) : 0
    return { ...p, sessions, completionRate: Math.round(rate * 100) / 100, weight: Math.round(all * 10) / 10 }
  })
}

function avoidedPeriods(periods: PeriodStats[]): AdaptivePlanningContext["avoid"] {
  const r = ADAPTIVE_RULES
  return periods
    .filter(
      (p) =>
        p.sessions >= r.minPeriodSessions &&
        p.weight >= 3 &&
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

// Pacing from workload: only when the student regularly plans more than they
// finish, with at least 8 such days, and below their own daily limit.
function pacingFrom(w: AdaptivePlanningContext["workload"], limit: number | undefined): Pacing | null {
  if (!w || w.days < 8 || w.typicalCompletedMinutes >= 0.8 * w.typicalPlannedMinutes) return null
  const softMinutes = Math.max(60, Math.ceil(w.typicalCompletedMinutes / 15) * 15)
  if (limit !== undefined && softMinutes >= limit) return null
  return {
    softMinutes,
    confidence: w.days >= 14 ? "high" : "medium",
    reason: `Paced near ${formatDuration(softMinutes)}: what you usually finish on busy days${limit ? `; urgent work can still use your ${formatDuration(limit)} limit` : ""}`,
  }
}

// ---- Insights (only with enough history) ---------------------------------------------

function insights(
  context: AdaptivePlanningContext,
  observations: Observation[],
  labels: Labels,
  poorTimes: AdaptivePlanningContext["avoid"],
  settings: LearningSettings
): Insight[] {
  const dismissed = new Set(settings.dismissedPatterns)
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
      observations: s.kept.length,
      affectsPlanning: settings.useEstimates && settings.planningMode !== "custom",
      dismissed: dismissed.has(`estimate:${key}`),
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
      observations: best.sessions,
      affectsPlanning: false,
      dismissed: false,
      text: `You finish most study sessions in the ${best.label} (${best.completed} of ${best.sessions} recently).`,
    })
  }
  for (const avoid of poorTimes) {
    const p = context.periods.find((x) => x.period === avoid.period)!
    const preferred = settings.preferredPeriods.includes(avoid.period)
    const inUse = context.avoid.some((a) => a.period === avoid.period)
    out.push({
      id: `avoid:${avoid.period}`,
      kind: "time-of-day",
      confidence: avoid.confidence,
      observations: p.sessions,
      affectsPlanning: inUse,
      dismissed: dismissed.has(`avoid:${avoid.period}`),
      text: preferred
        ? `${capitalize(p.label)} sessions are often missed or moved lately (${p.sessions - p.completed} of ${p.sessions}), but you said you prefer the ${p.label}, so the Planner keeps using it.`
        : `${capitalize(p.label)} sessions are often missed or moved lately (${p.sessions - p.completed} of ${p.sessions}), so the Planner uses other free time first when it can.`,
    })
  }
  const w = context.workload
  if (w && w.typicalCompletedMinutes < 0.8 * w.typicalPlannedMinutes) {
    out.push({
      id: "workload",
      kind: "workload",
      confidence: w.days >= 14 ? "high" : w.days >= 8 ? "medium" : "low",
      observations: w.days,
      affectsPlanning: context.pacing !== null,
      dismissed: dismissed.has("workload"),
      text: context.pacing
        ? `On days with study on your calendar, you usually finish about ${formatDuration(w.typicalCompletedMinutes)} of ${formatDuration(w.typicalPlannedMinutes)} planned, so the Planner paces non-urgent work near ${formatDuration(context.pacing.softMinutes)}. Your daily limit stays yours.`
        : `On days with study on your calendar, you usually finish about ${formatDuration(w.typicalCompletedMinutes)} of ${formatDuration(w.typicalPlannedMinutes)} planned. Your daily limit is yours to change in Settings.`,
    })
  }
  return out
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)
