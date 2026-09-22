import { daysBetween, fromDateKey } from "@/lib/format"
import type { Priority, Task } from "@/lib/types"

// How urgently a task needs attention on a given day. Higher = plan it first.
// Three simple parts, added together, so it's easy to see why a task ranks where it does.

// 1. Deadline: the closer the due date, the more points.
function deadlinePoints(daysLeft: number): number {
  if (daysLeft < 0) return 100 // overdue
  if (daysLeft === 0) return 90 // due today
  if (daysLeft === 1) return 75 // due tomorrow
  if (daysLeft <= 3) return 55
  if (daysLeft <= 7) return 35
  return 15
}

// 2. Priority set by the student.
const priorityPoints: Record<Priority, number> = {
  critical: 40,
  high: 30,
  medium: 15,
  low: 5,
}

// 3. Size: big tasks due soon need to be started earlier.
function sizePoints(estimateMinutes: number, daysLeft: number): number {
  return daysLeft <= 3 && estimateMinutes >= 120 ? 10 : 0
}

export function calculateTaskUrgency(task: Task, date: string): number {
  const daysLeft = daysBetween(fromDateKey(date), fromDateKey(task.dueDate))
  return deadlinePoints(daysLeft) + priorityPoints[task.priority] + sizePoints(task.estimateMinutes, daysLeft)
}

// Short, human reasons behind the score, shown next to recommendations.
export function urgencyReasons(task: Task, date: string): string[] {
  const daysLeft = daysBetween(fromDateKey(date), fromDateKey(task.dueDate))
  const reasons: string[] = []
  if (daysLeft < 0) reasons.push("Overdue")
  else if (daysLeft === 0) reasons.push("Due today")
  else if (daysLeft === 1) reasons.push("Due tomorrow")
  else reasons.push(`Due in ${daysLeft} days`)
  if (task.priority === "critical" || task.priority === "high") {
    reasons.push(`${task.priority === "critical" ? "Critical" : "High"} priority`)
  }
  if (sizePoints(task.estimateMinutes, daysLeft) > 0) reasons.push("Big task, start early")
  return reasons
}
