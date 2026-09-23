"use client"

import { useAppStore } from "@/lib/app-store"
import { useTasks } from "@/lib/task-store"
import { isDone, isImportant, isOverdue, todaysTasks } from "@/lib/tasks"

export function DashboardHeader({ greeting, dateLabel }: { greeting: string; dateLabel: string }) {
  const { tasks, today } = useTasks()
  const { firstName } = useAppStore().student
  const remaining = todaysTasks(tasks, today).filter((task) => !isDone(task))
  const important = remaining.filter(isImportant).length
  const overdue = tasks.filter((task) => isOverdue(task, today)).length

  let message: string
  if (remaining.length === 0 && overdue > 0)
    message = `You have ${overdue} overdue ${overdue === 1 ? "task" : "tasks"} to catch up on.`
  else if (remaining.length === 0) message = "You're all caught up for today."
  else if (important > 0)
    message = `You have ${important} important ${important === 1 ? "task" : "tasks"} today.`
  else
    message = `Important work is done. ${remaining.length} smaller ${remaining.length === 1 ? "task" : "tasks"} left.`

  return (
    <header>
      <p className="text-sm font-medium text-muted-foreground">{dateLabel}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
        {firstName ? `${greeting}, ${firstName}` : greeting}
      </h1>
      <p className="mt-1.5 text-muted-foreground" aria-live="polite">
        {message}
      </p>
    </header>
  )
}
