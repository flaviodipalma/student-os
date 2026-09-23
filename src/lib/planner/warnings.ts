import { addDays, formatDuration } from "@/lib/format"
import type { Task } from "@/lib/types"
import type { PlannerSettings } from "./settings"
import type { DailyPlan, PlannerWarning } from "./types"

// "Needs attention": the few things about a day's plan worth telling the
// student, most serious first. Only real problems are reported, at most
// settings.maxWarnings of them:
//
// 1. Overdue tasks (planning today only).
// 2. Work that couldn't fit into the day.
// 3. Important work (major work or critical priority) due the next day; more
//    urgent if the student removed it from this day's plan.
// 4. Very little free time on a day with work to do.
// 5. Tasks without a time estimate (planned with a fallback length).

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

  // 2. Work that didn't fit.
  if (plan.unscheduled.length > 0) {
    const count = plan.unscheduled.length
    warnings.push({
      id: "unscheduled",
      kind: "unscheduled",
      severity: plan.unscheduled.some((item) => item.atRisk) ? "high" : "medium",
      message: `${plural(count, "task")} could not fit into ${isToday ? "today's" : "this day's"} plan.`,
      taskIds: plan.unscheduled.map((item) => item.taskId),
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

  // 4. Little free time on a day with work to do (none at all is the plan's status).
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

  // 5. Missing estimates.
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
