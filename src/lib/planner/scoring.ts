import { durationMinutes } from "@/lib/events"
import { daysBetween, fromDateKey } from "@/lib/format"
import { typeLabel } from "@/lib/tasks"
import type { CalendarEvent, Task } from "@/lib/types"
import { DEFAULT_SCORING, type PlannerSettings, type ScoringWeights } from "./settings"
import type { ScoreFactor, ScoredTask } from "./types"

// ---- Remaining work --------------------------------------------------------
//
// A task stays one task; study sessions record the work done or planned on it.
//
//   remaining = estimate − completed study (any day) − booked study (today onward)
//
// A past session that wasn't marked done doesn't count: it was probably missed.

// The estimate the planner works with. Tasks without a usable estimate get the
// fallback (and the student is asked to add one).
export function estimateOf(task: Task, settings: Pick<PlannerSettings, "fallbackEstimateMinutes">) {
  const missing = !Number.isFinite(task.estimateMinutes) || task.estimateMinutes <= 0
  return { minutes: missing ? settings.fallbackEstimateMinutes : task.estimateMinutes, missing }
}

// Minutes of a task already covered by study sessions on the calendar.
export function plannedMinutesFor(taskId: string, events: CalendarEvent[], today: string): number {
  return events
    .filter((e) => e.type === "study" && e.taskId === taskId && (e.completed || e.date >= today))
    .reduce((sum, e) => sum + durationMinutes(e), 0)
}

// Minutes of completed study on a task (any day).
export function completedMinutesFor(taskId: string, events: CalendarEvent[]): number {
  return events
    .filter((e) => e.type === "study" && e.taskId === taskId && e.completed)
    .reduce((sum, e) => sum + durationMinutes(e), 0)
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
  }

  return {
    task,
    score: factors.reduce((sum, factor) => sum + factor.points, 0),
    factors,
    daysLeft,
    remainingMinutes: context.remainingMinutes,
    estimateMissing: context.estimateMissing,
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
    { date, remainingMinutes: task.estimateMinutes, estimateMissing: false, started: false, capacityBeforeDue: Infinity },
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
