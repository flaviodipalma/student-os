import { addDays, daysBetween, formatDuration, formatRelativeDay, fromDateKey } from "@/lib/format"
import type { Task } from "@/lib/types"
import type { PlannerSettings } from "./settings"
import type { DailyPlan, PlannerWarning } from "./types"

// "Needs attention": the few things about a day's plan worth telling the
// student, most serious first. Only real problems are reported, at most
// settings.maxWarnings of them:
//
// 1. Overdue tasks (planning today only).
// 2. Work due soon (within 2 days, or overdue) that couldn't fit into the day. Work
//    due later that didn't fit is normal: it's planned on later days, so it isn't
//    reported (useful awareness, not anxiety).
// 3. Important work (major work or critical priority) due the next day; more
//    urgent if the student removed it from this day's plan.
// 4. Work that won't fit before its deadline (remaining work > study time the
//    planner can find before it). Facts only: the student decides what to do.
// 5. Missed study sessions (their work is back in the plan).
// 6. Very little free time on a day with work to do.
// 7. Tasks without a time estimate (planned with a fallback length).

export type WarningContext = {
  plan: DailyPlan
  today: string
  openTasks: Task[]
  settings: PlannerSettings
}

const severityOrder = { high: 0, medium: 1, low: 2 }
const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export function buildWarnings({ plan, today, openTasks, settings }: WarningContext): PlannerWarning[] {
  if (plan.status === "past") return []
  const warnings: PlannerWarning[] = []
  const isToday = plan.date === today
  const dayName = isToday ? "today" : "this day"
  const unscheduledIds = new Set(plan.unscheduled.map((item) => item.taskId))

  // 1. Overdue tasks.
  if (isToday) {
    const overdue = openTasks.filter((task) => task.dueDate < today)
    if (overdue.length > 0) {
      warnings.push({
        id: "overdue",
        kind: "overdue",
        severity: "high",
        message:
          overdue.length === 1
            ? `${overdue[0].title} is overdue.`
            : `You have ${plural(overdue.length, "overdue task")}.`,
        taskIds: overdue.map((task) => task.id),
        action: overdue.length === 1 ? "view-task" : undefined,
      })
    }
  }

  // 2. Work due soon that didn't fit.
  const atRisk = plan.unscheduled.filter((item) => item.atRisk)
  if (atRisk.length > 0) {
    const count = atRisk.length
    warnings.push({
      id: "unscheduled",
      kind: "unscheduled",
      severity: "high",
      message:
        count === 1
          ? `${openTasks.find((task) => task.id === atRisk[0].taskId)?.title ?? "A task"} is due soon and didn't fully fit into ${isToday ? "today's" : "this day's"} plan.`
          : `${plural(count, "task")} due soon didn't fully fit into ${isToday ? "today's" : "this day's"} plan.`,
      taskIds: atRisk.map((item) => item.taskId),
      action: "plan-next-day",
    })
  }

  // 3. Important work due the next day.
  const nextDay = addDays(plan.date, 1)
  const important = (task: Task) =>
    task.priority === "critical" || settings.scoring.majorTypes.includes(task.type)
  for (const task of openTasks) {
    if (task.dueDate !== nextDay || !important(task) || unscheduledIds.has(task.id)) continue
    const removed = plan.skippedTaskIds.includes(task.id)
    const when = isToday ? "tomorrow" : "the next day"
    warnings.push({
      id: `due-soon-${task.id}`,
      kind: "due-soon",
      severity: removed ? "high" : "medium",
      message: removed
        ? `${task.title} is due ${when} and isn't in ${isToday ? "today's" : "this day's"} plan.`
        : `${task.title} is due ${when}.`,
      taskIds: [task.id],
      action: "view-task",
    })
  }

  // 4. Not enough time before the deadline.
  for (const scored of plan.ranked) {
    const { task, remainingMinutes } = scored
    const capacity = scored.capacityThroughDue ?? scored.capacityBeforeDue
    if (!Number.isFinite(capacity) || remainingMinutes <= capacity || task.dueDate < plan.date) continue
    const daysLeft = daysBetween(fromDateKey(today), fromDateKey(task.dueDate))
    // "today", "tomorrow", "Friday", "Wed, Oct 1"
    const when = daysLeft === 0 ? "today" : daysLeft === 1 ? "tomorrow" : formatRelativeDay(fromDateKey(task.dueDate), fromDateKey(today))
    warnings.push({
      id: `not-enough-time-${task.id}`,
      kind: "not-enough-time",
      severity: daysLeft <= 2 ? "high" : "medium",
      message:
        capacity <= 0
          ? `${task.title} is due ${when}, with ${formatDuration(remainingMinutes)} left and no study time available before it.`
          : `${task.title}: ${formatDuration(remainingMinutes)} left, but only about ${formatDuration(capacity)} of study time before it's due ${when}.`,
      taskIds: [task.id],
      action: "view-task",
    })
  }

  // 5. Missed study sessions (today's plan only; the work is already re-planned).
  if (isToday) {
    const missed = plan.ranked.filter((scored) => scored.factors.some((factor) => factor.key === "missed-session"))
    if (missed.length > 0) {
      warnings.push({
        id: "missed",
        kind: "missed",
        severity: "low",
        message:
          missed.length === 1
            ? `You missed a study session for ${missed[0].task.title}. Its work is back in your plan.`
            : `You missed study sessions for ${plural(missed.length, "task")}. Their work is back in your plan.`,
        taskIds: missed.map((scored) => scored.task.id),
        action: missed.length === 1 ? "view-task" : undefined,
      })
    }
  }

  // 6. Little free time on a day with work to do (none at all is the plan's status).
  const needsTime = plan.ranked.length > 0
  if (needsTime && plan.status === "ok" && plan.freeMinutes < settings.lowTimeMinutes) {
    warnings.push({
      id: "limited-time",
      kind: "limited-time",
      severity: "medium",
      message: `Your available study time is limited ${dayName} (${formatDuration(plan.freeMinutes)} free).`,
      taskIds: [],
      action: "plan-next-day",
    })
  }

  // 7. Missing estimates.
  const noEstimate = plan.ranked.filter((scored) => scored.estimateMissing)
  if (noEstimate.length > 0) {
    warnings.push({
      id: "no-estimate",
      kind: "no-estimate",
      severity: "low",
      message:
        noEstimate.length === 1
          ? `${noEstimate[0].task.title} has no time estimate, so it's planned as ${formatDuration(settings.fallbackEstimateMinutes)}. Add one for a better plan.`
          : `${plural(noEstimate.length, "task")} have no time estimate. Add estimates for a better plan.`,
      taskIds: noEstimate.map((scored) => scored.task.id),
      action: noEstimate.length === 1 ? "view-task" : undefined,
    })
  }

  // Keep the order stable: severity, then the order the rules above ran in.
  return warnings
    .map((warning, index) => ({ warning, index }))
    .sort((a, b) => severityOrder[a.warning.severity] - severityOrder[b.warning.severity] || a.index - b.index)
    .slice(0, settings.maxWarnings)
    .map(({ warning }) => warning)
}
