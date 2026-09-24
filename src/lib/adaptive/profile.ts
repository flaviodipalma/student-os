import { toMinutes } from "@/lib/events"
import { formatDuration, fromDateKey } from "@/lib/format"
import type { LearningSettings, StudySessionRecord, Task, TaskType } from "@/lib/types"
import type { AdaptivePlanningContext, Confidence, Observation, Pacing, PeriodStats } from "./index"
import { median, robustSummary } from "./stats"

// The StudentPlanningProfile: everything Student OS knows about how this student
// plans, in three clearly separate parts.
//
//   explicit   what the student told us (settings, mode, preferred times)
//   observed   what their own history shows: each value with its confidence,
//              sample size, the date of the newest evidence and where it came from
//   inferred   what the Planner does because of it (and only if switched on)
//
// Only signals that help planning or explain it are included, and only with
// enough evidence: a value that isn't supported yet is simply absent.

export type ProfileEntry<T> = {
  value: T
  confidence: Confidence
  observations: number
  // The date of the newest evidence ("YYYY-MM-DD").
  updatedAt: string
  source: string
  explanation: string
}

export type StudentPlanningProfile = {
  asOf: string
  learning: "on" | "off" | "custom"
  explicit: {
    planningMode: LearningSettings["planningMode"]
    preferredPeriods: LearningSettings["preferredPeriods"]
    tasksUsingOwnEstimate: number
    turnedOffPatterns: number
  }
  observed: {
    sessionCompletionRate?: ProfileEntry<number>
    rescheduleRate?: ProfileEntry<number>
    typicalSessionMinutes?: ProfileEntry<number>
    typicalStudyMinutesPerDay?: ProfileEntry<number>
    typicalStudyDays?: ProfileEntry<string[]>
    bestStudyTime?: ProfileEntry<string>
    oftenMissedTimes?: ProfileEntry<string[]>
    estimateAccuracy?: ProfileEntry<number>
    estimatesByKind: ProfileEntry<{ label: string; ratio: number }>[]
    unfinishedDayRate?: ProfileEntry<number>
    oftenPostponedTypes?: ProfileEntry<string[]>
    sessionsPerLargeTask?: ProfileEntry<number>
  }
  inferred: { text: string; confidence: Confidence }[]
}

type ProfileInput = {
  settings: LearningSettings
  today: string
  tasks?: Task[]
  // Recent sessions (habits) and all sessions since the learning start.
  sessions?: StudySessionRecord[]
  allSessions?: StudySessionRecord[]
  observations?: (Observation & { label: string; typeLabel: string })[]
  periods?: PeriodStats[]
  poorTimes?: AdaptivePlanningContext["avoid"]
  workload?: AdaptivePlanningContext["workload"]
  pacing?: Pacing | null
  estimatesInUse?: number
  // Times the Planner actually uses last (after the student's switches and preferences).
  avoidInUse?: AdaptivePlanningContext["avoid"]
}

const byCount = (n: number, medium: number, high: number): Confidence => (n >= high ? "high" : n >= medium ? "medium" : "low")
const pct = (x: number) => Math.round(x * 100) / 100
const newest = (dates: string[]) => dates.reduce((a, b) => (b > a ? b : a), "")
const lengthOf = (s: StudySessionRecord) => toMinutes(s.endTime) - toMinutes(s.startTime)
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const TYPE_PLURAL: Record<TaskType, string> = {
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

export function buildProfile(input: ProfileInput): StudentPlanningProfile {
  const { settings, today } = input
  const profile: StudentPlanningProfile = {
    asOf: today,
    learning: !settings.enabled ? "off" : settings.planningMode === "custom" ? "custom" : "on",
    explicit: {
      planningMode: settings.planningMode,
      preferredPeriods: settings.preferredPeriods,
      tasksUsingOwnEstimate: settings.ownEstimateTaskIds.length,
      turnedOffPatterns: settings.dismissedPatterns.length,
    },
    observed: { estimatesByKind: [] },
    inferred: [],
  }
  if (!settings.enabled) return profile
  const sessions = input.sessions ?? []
  const all = input.allSessions ?? []
  const o = profile.observed

  // Of the sessions that were on the calendar (not removed), how many got done.
  const decided = sessions.filter((s) => s.status !== "skipped")
  if (decided.length >= 10) {
    const done = decided.filter((s) => s.status === "completed").length
    o.sessionCompletionRate = {
      value: pct(done / decided.length),
      confidence: byCount(decided.length, 15, 30),
      observations: decided.length,
      updatedAt: newest(decided.map((s) => s.date)),
      source: "Your study sessions in the last 90 days",
      explanation: `You finished ${done} of your last ${decided.length} planned study sessions.`,
    }
    const moved = decided.filter((s) => (s.rescheduleCount ?? 0) > 0).length
    o.rescheduleRate = {
      value: pct(moved / decided.length),
      confidence: byCount(decided.length, 15, 30),
      observations: decided.length,
      updatedAt: o.sessionCompletionRate.updatedAt,
      source: "Study sessions you moved in Student OS",
      explanation: `You moved ${moved} of your last ${decided.length} study sessions to another time.`,
    }
  }

  const completed = sessions.filter((s) => s.status === "completed")
  if (completed.length >= 8) {
    const typical = Math.round(median(completed.map(lengthOf)) / 5) * 5
    o.typicalSessionMinutes = {
      value: typical,
      confidence: byCount(completed.length, 15, 30),
      observations: completed.length,
      updatedAt: newest(completed.map((s) => s.date)),
      source: "Completed study sessions",
      explanation: `Your completed study sessions are usually about ${formatDuration(typical)} long.`,
    }
    const perDay = new Map<string, number>()
    for (const s of completed) perDay.set(s.date, (perDay.get(s.date) ?? 0) + (s.completedMinutes ? Math.min(s.completedMinutes, lengthOf(s)) : lengthOf(s)))
    if (perDay.size >= 5) {
      const minutes = Math.round(median([...perDay.values()]) / 5) * 5
      o.typicalStudyMinutesPerDay = {
        value: minutes,
        confidence: byCount(perDay.size, 10, 20),
        observations: perDay.size,
        updatedAt: newest([...perDay.keys()]),
        source: "Days you finished study sessions",
        explanation: `On days you study, you usually finish about ${formatDuration(minutes)}.`,
      }
      const days = new Map<number, number>()
      for (const date of perDay.keys()) days.set(fromDateKey(date).getDay(), (days.get(fromDateKey(date).getDay()) ?? 0) + 1)
      const most = Math.max(...days.values())
      const usual = [...days.entries()].filter(([, n]) => n >= Math.max(2, most * 0.6)).map(([d]) => d).sort()
      if (usual.length > 0 && usual.length < 7) {
        o.typicalStudyDays = {
          value: usual.map((d) => WEEKDAYS[d]),
          confidence: byCount(perDay.size, 10, 20),
          observations: perDay.size,
          updatedAt: o.typicalStudyMinutesPerDay.updatedAt,
          source: "Days you finished study sessions",
          explanation: `You study most often on ${usual.map((d) => WEEKDAYS[d]).join(", ")}.`,
        }
      }
    }
  }

  const periods = input.periods ?? []
  const best = [...periods].filter((p) => p.sessions >= 6 && p.completionRate >= 0.7).sort((a, b) => b.completionRate - a.completionRate)[0]
  if (best) {
    o.bestStudyTime = {
      value: best.label,
      confidence: byCount(best.sessions, 8, 15),
      observations: best.sessions,
      updatedAt: newest(sessions.map((s) => s.date)),
      source: "Study session completion by time of day (recent weeks count more)",
      explanation: `You finish most study sessions in the ${best.label} (${best.completed} of ${best.sessions} recently).`,
    }
  }
  const poor = input.poorTimes ?? []
  if (poor.length > 0) {
    const n = poor.reduce((sum, p) => sum + (periods.find((x) => x.period === p.period)?.sessions ?? 0), 0)
    o.oftenMissedTimes = {
      value: poor.map((p) => periods.find((x) => x.period === p.period)!.label),
      confidence: poor.some((p) => p.confidence === "low") ? "low" : poor.some((p) => p.confidence === "medium") ? "medium" : "high",
      observations: n,
      updatedAt: newest(sessions.map((s) => s.date)),
      source: "Missed, moved and removed study sessions by time of day",
      explanation: `Sessions in the ${poor.map((p) => periods.find((x) => x.period === p.period)!.label).join(" and ")} are often missed or moved.`,
    }
  }

  // Estimates: overall, and by kind of task (course + type, then type) with enough tasks.
  const observations = (input.observations ?? []).filter((x) => x.estimate !== null)
  if (observations.length >= 5) {
    const s = robustSummary(observations.map((x) => ({ value: x.actual / x.estimate!, weight: x.weight })))
    o.estimateAccuracy = {
      value: Math.round(s.median * 10) / 10,
      confidence: s.kept.length >= 12 && s.spread <= 0.15 ? "high" : s.kept.length >= 5 && s.spread <= 0.25 ? "medium" : "low",
      observations: s.kept.length,
      updatedAt: newest(observations.map((x) => x.lastDate)),
      source: "Finished tasks with logged study time",
      explanation: `Your finished tasks took about ${Math.round(s.median * 10) / 10}× your estimates overall.`,
    }
    const groups = new Map<string, typeof observations>()
    for (const x of observations) {
      groups.set(x.label, [...(groups.get(x.label) ?? []), x])
      groups.set(x.typeLabel, [...(groups.get(x.typeLabel) ?? []), x])
    }
    for (const [label, items] of [...groups.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      if (items.length < 5) continue
      const g = robustSummary(items.map((x) => ({ value: x.actual / x.estimate!, weight: x.weight })))
      const ratio = Math.round(g.median * 10) / 10
      o.estimatesByKind.push({
        value: { label, ratio },
        confidence: g.kept.length >= 12 && g.spread <= 0.15 ? "high" : g.kept.length >= 5 && g.spread <= 0.25 ? "medium" : "low",
        observations: g.kept.length,
        updatedAt: newest(items.map((x) => x.lastDate)),
        source: "Finished tasks with logged study time",
        explanation: `Your last ${g.kept.length} ${label} took about ${ratio}× your estimates.`,
      })
    }
  }

  const w = input.workload
  if (w) {
    const days = new Map<string, { planned: number; done: number }>()
    for (const s of all.filter((x) => x.status !== "skipped")) {
      const d = days.get(s.date) ?? { planned: 0, done: 0 }
      d.planned += lengthOf(s)
      if (s.status === "completed") d.done += s.completedMinutes ? Math.min(s.completedMinutes, lengthOf(s)) : lengthOf(s)
      days.set(s.date, d)
    }
    const busy = [...days.entries()].filter(([, d]) => d.planned >= 60)
    const unfinished = busy.filter(([, d]) => d.done < 0.8 * d.planned).length
    o.unfinishedDayRate = {
      value: pct(unfinished / busy.length),
      confidence: byCount(busy.length, 8, 14),
      observations: busy.length,
      updatedAt: newest(busy.map(([d]) => d)),
      source: "Days with study on your calendar",
      explanation: `On ${unfinished} of your last ${busy.length} days with study on the calendar, you finished less than 80% of it.`,
    }
  }

  // Kinds of task whose sessions are often missed or moved.
  const typeOf = new Map((input.tasks ?? []).map((t) => [t.id, t.type]))
  const byType = new Map<TaskType, { n: number; notDone: number; dates: string[] }>()
  for (const s of sessions.filter((x) => x.status !== "skipped")) {
    const type = typeOf.get(s.taskId)
    if (!type) continue
    const t = byType.get(type) ?? { n: 0, notDone: 0, dates: [] }
    t.n++
    if (s.status !== "completed" || (s.rescheduleCount ?? 0) > 0) t.notDone++
    t.dates.push(s.date)
    byType.set(type, t)
  }
  const postponed = [...byType.entries()].filter(([, t]) => t.n >= 6 && t.notDone / t.n >= 0.5)
  if (postponed.length > 0) {
    const n = postponed.reduce((sum, [, t]) => sum + t.n, 0)
    o.oftenPostponedTypes = {
      value: postponed.map(([type]) => TYPE_PLURAL[type]),
      confidence: byCount(n, 12, 24),
      observations: n,
      updatedAt: newest(postponed.flatMap(([, t]) => t.dates)),
      source: "Missed and moved study sessions by kind of task",
      explanation: `Study sessions for ${postponed.map(([type]) => TYPE_PLURAL[type]).join(" and ")} are often missed or moved.`,
    }
  }

  // Large tasks (2h or more of logged work): how many sessions they usually take.
  const large = (input.observations ?? []).filter((x) => x.actual >= 120)
  if (large.length >= 3) {
    const typical = Math.round(median(large.map((x) => x.sessions)))
    o.sessionsPerLargeTask = {
      value: typical,
      confidence: byCount(large.length, 5, 10),
      observations: large.length,
      updatedAt: newest(large.map((x) => x.lastDate)),
      source: "Finished tasks with 2h or more of logged work",
      explanation: `Your bigger tasks usually take about ${typical} study session${typical === 1 ? "" : "s"}.`,
    }
  }

  // What the Planner does with it (only what's switched on).
  if ((input.estimatesInUse ?? 0) > 0) profile.inferred.push({ text: `${input.estimatesInUse} open task${input.estimatesInUse === 1 ? " is" : "s are"} planned with a learned estimate.`, confidence: o.estimateAccuracy?.confidence ?? "low" })
  for (const a of input.avoidInUse ?? []) profile.inferred.push({ text: `${a.reason}, so the Planner uses other free time first.`, confidence: a.confidence })
  if (input.pacing) profile.inferred.push({ text: input.pacing.reason + ".", confidence: input.pacing.confidence })
  return profile
}
