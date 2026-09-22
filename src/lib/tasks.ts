import { courses } from "@/lib/data/courses"
import { daysBetween, formatRelativeDay, formatTime, fromDateKey } from "@/lib/format"
import type { Priority, Task, TaskStatus, TaskType } from "@/lib/types"

// Labels and rules for tasks, shared by every page that shows them.

export const priorityLabel: Record<Priority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
  low: "Low",
}

// Highest first.
export const priorities: Priority[] = ["critical", "high", "medium", "low"]

export const statusLabel: Record<TaskStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
}

export const typeLabel: Record<TaskType, string> = {
  assignment: "Assignment",
  exam: "Exam",
  quiz: "Quiz",
  project: "Project",
  reading: "Reading",
  lab: "Lab report",
  study: "Study",
  other: "Other",
}

export function isDone(task: Task): boolean {
  return task.status === "completed"
}

export function daysUntilDue(task: Task, today: string): number {
  return daysBetween(fromDateKey(today), fromDateKey(task.dueDate))
}

export function isOverdue(task: Task, today: string): boolean {
  return !isDone(task) && task.dueDate < today
}

// "today at 5:00 PM", "tomorrow at 11:59 PM", "Friday at 9:00 AM", "Wed, Oct 1"
export function formatDue(task: Task, today: string): string {
  const day = formatRelativeDay(fromDateKey(task.dueDate), fromDateKey(today))
  const nearby = day === "Today" || day === "Tomorrow"
  const label = nearby ? day.toLowerCase() : day
  const days = daysUntilDue(task, today)
  if (!task.dueTime || days < 0 || days >= 7) return label
  return `${label} at ${formatTime(fromDateKey(task.dueDate, task.dueTime))}`
}

// 45 -> "45 min", 90 -> "90 min", 240 -> "4h"
export function formatEstimate(minutes: number): string {
  if (minutes < 120) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

// ---- Sorting -------------------------------------------------------------

// Tasks without a time count as due at the end of the day.
function dueKey(task: Task): string {
  return `${task.dueDate}T${task.dueTime ?? "23:59"}`
}

export function byDue(a: Task, b: Task): number {
  return dueKey(a).localeCompare(dueKey(b))
}

export function byPriority(a: Task, b: Task): number {
  return priorities.indexOf(a.priority) - priorities.indexOf(b.priority) || byDue(a, b)
}

const courseOrder = new Map(courses.map((course, index) => [course.id, index]))

export function byCourse(a: Task, b: Task): number {
  return (courseOrder.get(a.courseId) ?? 99) - (courseOrder.get(b.courseId) ?? 99) || byDue(a, b)
}

// ---- Selections ----------------------------------------------------------

// Course → Tasks
export function tasksForCourse(tasks: Task[], courseId: string): Task[] {
  return tasks.filter((task) => task.courseId === courseId)
}

// What's on today's list: tasks planned for today plus anything due today.
export function todaysTasks(tasks: Task[], today: string): Task[] {
  return tasks
    .filter((task) => task.plannedDate === today || task.dueDate === today)
    .sort(byPriority)
}

// Graded work (not study prep) that's still open, soonest first.
export function upcomingDeadlines(tasks: Task[], today: string): Task[] {
  return tasks
    .filter((task) => task.type !== "study" && !isDone(task) && task.dueDate >= today)
    .sort(byDue)
}

export function isImportant(task: Task): boolean {
  return task.priority === "high" || task.priority === "critical"
}
