import { durationMinutes, toMinutes } from "@/lib/events"
import { addDays, daysBetween, formatDuration, fromDateKey } from "@/lib/format"
import { typeLabel } from "@/lib/tasks"
import type { CalendarEvent, Task } from "@/lib/types"
import { DEFAULT_PLANNER_SETTINGS, DEFAULT_SCORING, type PlannerSettings, type ScoringWeights } from "./settings"
import type { ScoreFactor, ScoredTask } from "./types"

// ---- Remaining work --------------------------------------------------------
//
// A task stays one task; study sessions record the work done or planned on it.
//
//   remaining = estimate − work done (completed sessions; a partly done session
//               counts the minutes actually worked) − booked study still ahead
//
// A session that ended without being marked done doesn't count: it was missed,
// so its work goes back into the plan (it's never marked done automatically).

// Minutes of work a study session stands for: what was actually worked if it was
// done only partly, otherwise its length.
export function workedMinutes(event: CalendarEvent): number {
  return event.completed && event.completedMinutes ? Math.min(event.completedMinutes, durationMinutes(event)) : durationMinutes(event)
}

// Scheduled (not done) and already over: missed. `nowMinutes` = the time today.
export function isMissed(event: CalendarEvent, today: string, nowMinutes: number): boolean {
  if (event.type !== "study" || !event.taskId || event.completed) return false
  return event.date < today || (event.date === today && toMinutes(event.endTime) <= nowMinutes)
}

// The estimate the planner works with. Tasks without a usable estimate get the
// fallback (and the student is asked to add one). A learned estimate (adaptive
// planning) is used instead when there is one; `missing` still says whether the
// student gave an estimate.
export function estimateOf(
  task: Task,
  settings: Pick<PlannerSettings, "fallbackEstimateMinutes">,
  learned?: { minutes: number; reason: string }
): { minutes: number; missing: boolean; learned?: { minutes: number; reason: string } } {
  const minutes = task.estimateMinutes
  const missing = minutes === null || !Number.isFinite(minutes) || minutes <= 0
  if (learned && Number.isFinite(learned.minutes) && learned.minutes > 0) return { minutes: Math.round(learned.minutes), missing, learned }
  return missing ? { minutes: settings.fallbackEstimateMinutes, missing: true } : { minutes: minutes!, missing: false }
}

// Minutes of a task already covered by study sessions: work done, plus booked
// sessions that haven't ended yet (`nowMinutes`: the time today; by default the
// whole of today counts as ahead).
export function plannedMinutesFor(taskId: string, events: CalendarEvent[], today: string, nowMinutes = -1): number {
  return events
    .filter((e) => e.type === "study" && e.taskId === taskId && (e.completed || !isMissed(e, today, nowMinutes)))
    .filter((e) => e.completed || e.date >= today)
    .reduce((sum, e) => sum + workedMinutes(e), 0)
}

// Minutes of completed study on a task (any day).
export function completedMinutesFor(taskId: string, events: CalendarEvent[]): number {
  return events
    .filter((e) => e.type === "study" && e.taskId === taskId && e.completed)
    .reduce((sum, e) => sum + workedMinutes(e), 0)
}

// Sessions for a task missed in the last `days` days (including earlier today).
export function missedSessionsFor(taskId: string, events: CalendarEvent[], today: string, nowMinutes: number, days = 7): number {
  const since = addDays(today, -days)
  return events.filter((e) => e.taskId === taskId && e.date >= since && isMissed(e, today, nowMinutes)).length
}

// ---- Scoring ----------------------------------------------------------------
//
// Each factor is simple and independent; the score is their sum. The same
// factors produce the "Why this?" reasons, so the explanation is always the
// real reason. Weights are in settings.ts (DEFAULT_SCORING).

export type ScoringContext = {
  // The day being planned.
  date: string
  // The real today. Deadline reasons are worded from here ("Due tomorrow"),
  // even when planning a later day. Defaults to `date`.
  today?: string
  remainingMinutes: number
  estimateMissing: boolean
  // Study already done or in progress on this task.
  started: boolean
  // Study time the planner could still find from `date` until the deadline
  // (Infinity when unknown). Less than the remaining work = tight on time.
  capacityBeforeDue: number
  // Remaining work of the OTHER open tasks due on or before this task's deadline.
  competingMinutes?: number
  // Planned sessions for this task missed recently.
  missedSessions?: number
  // The student's own emphasis on this task (PlanningStrategy.boosts).
  boost?: { points: number; label: string }
  // Today only: the free time starting now, in minutes, when it's short (the
  // task's remaining work fitting in it gets a small bonus).
  freeNowMinutes?: number
}

// Points come from the days left on the planned day; the label says when it's due from today.
function deadlineFactor(daysLeft: number, daysFromToday: number, w: ScoringWeights): ScoreFactor {
  const d = w.deadline
  const label =
    daysFromToday < 0
      ? "Overdue"
      : daysFromToday === 0
        ? "Due today"
        : daysFromToday === 1
          ? "Due tomorrow"
          : `Due in ${daysFromToday} days`
  const points =
    daysLeft < 0
      ? d.overdue
      : daysLeft === 0
        ? d.today
        : daysLeft === 1
          ? d.tomorrow
          : daysLeft <= 3
            ? d.soon
            : daysLeft <= 7
              ? d.thisWeek
              : d.later
  return { key: "deadline", label, points }
}

const priorityLabel = { critical: "Critical priority", high: "High priority", medium: null, low: null }

export function scoreTask(task: Task, context: ScoringContext, weights: ScoringWeights = DEFAULT_SCORING): ScoredTask {
  const daysLeft = daysBetween(fromDateKey(context.date), fromDateKey(task.dueDate))
  const daysFromToday = daysBetween(fromDateKey(context.today ?? context.date), fromDateKey(task.dueDate))
  const factors: ScoreFactor[] = [
    // 1. Deadline: the closer, the more points; overdue gets the most.
    deadlineFactor(daysLeft, daysFromToday, weights),
    // 2. Priority set by the student.
    { key: "priority", label: priorityLabel[task.priority], points: weights.priority[task.priority] },
  ]
  // 3. Major work (exams, projects, papers, presentations) coming up.
  if (weights.majorTypes.includes(task.type) && daysLeft <= weights.majorWorkDays) {
    factors.push({ key: "major-work", label: `${typeLabel[task.type]} coming up`, points: weights.majorWork })
  }
  // 4. A lot of work left and the deadline isn't far: start early rather than cram.
  if (context.remainingMinutes >= weights.largeTaskMinutes && daysLeft >= 1 && daysLeft <= weights.largeTaskDays) {
    factors.push({ key: "large-task", label: "Large task — started early", points: weights.largeTask })
  }
  // 5. Already started: keep the momentum.
  if (context.started) factors.push({ key: "in-progress", label: "Already started", points: weights.inProgress })
  // 6. Not enough study time left before the deadline for the remaining work.
  if (context.remainingMinutes > context.capacityBeforeDue) {
    factors.push({ key: "tight-on-time", label: "Tight on time before the deadline", points: weights.tightOnTime })
  } else if (
    // 7. It fits on its own, but not with everything else due by then.
    (context.competingMinutes ?? 0) > 0 &&
    context.remainingMinutes + (context.competingMinutes ?? 0) > context.capacityBeforeDue
  ) {
    factors.push({ key: "competing-deadlines", label: "Other deadlines compete for the same time", points: weights.competingDeadlines })
  }
  // 8. A planned session was missed: the work is back, a little more urgent.
  if ((context.missedSessions ?? 0) > 0) {
    factors.push({ key: "missed-session", label: "You missed a planned session for this", points: weights.missedSession })
  }
  // 9. The student asked to put this first (e.g. "focus on my exam").
  if (context.boost && context.boost.points > 0) {
    factors.push({ key: "focus", label: context.boost.label, points: context.boost.points })
  }
  // 10. It can be finished in the free time right now (a short window): a
  //     small nudge, so a 30-minute reading goes in a 75-minute gap before a
  //     90-minute assignment that wouldn't fit. Deadlines still weigh more.
  if (context.freeNowMinutes !== undefined && context.remainingMinutes > 0 && context.remainingMinutes <= context.freeNowMinutes) {
    factors.push({ key: "fits-now", label: `Fits in the ${formatDuration(context.freeNowMinutes)} you have free now`, points: weights.fitsNow ?? 10 })
  }

  return {
    task,
    score: factors.reduce((sum, factor) => sum + factor.points, 0),
    factors,
    daysLeft,
    remainingMinutes: context.remainingMinutes,
    estimateMissing: context.estimateMissing,
    capacityBeforeDue: context.capacityBeforeDue,
  }
}

// Plain string order, the same on every machine (localeCompare can differ).
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

// Planning order: highest score first. Ties go to the earlier deadline, then
// the earlier due time, then title and id, so the order never depends on how
// the tasks happened to be sorted.
export function compareScored(a: ScoredTask, b: ScoredTask): number {
  return (
    b.score - a.score ||
    compare(a.task.dueDate, b.task.dueDate) ||
    compare(a.task.dueTime ?? "24:00", b.task.dueTime ?? "24:00") ||
    compare(a.task.title, b.task.title) ||
    compare(a.task.id, b.task.id)
  )
}

// The score of a task on a date, from deadline, priority and size alone.
export function calculateTaskUrgency(task: Task, date: string, weights: ScoringWeights = DEFAULT_SCORING): number {
  return scoreTask(
    task,
    {
      date,
      remainingMinutes: estimateOf(task, DEFAULT_PLANNER_SETTINGS).minutes,
      estimateMissing: false,
      started: false,
      capacityBeforeDue: Infinity,
    },
    weights
  ).score
}

// The visible reasons behind a score, most important first.
export function reasonsOf(scored: ScoredTask): string[] {
  return scored.factors
    .filter((factor) => factor.label)
    .sort((a, b) => b.points - a.points)
    .map((factor) => factor.label!)
}
