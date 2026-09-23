"use client"

import Link from "next/link"
import { TaskRow } from "@/components/tasks/task-row"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatDuration } from "@/lib/format"
import { useTasks } from "@/lib/task-store"
import { isDone, todaysTasks } from "@/lib/tasks"

export function PriorityTasks({ className }: { className?: string }) {
  const { tasks, today } = useTasks()
  const todays = todaysTasks(tasks, today)
  const remaining = todays.filter((task) => !isDone(task))
  const minutesLeft = remaining.reduce((sum, task) => sum + (task.estimateMinutes ?? 0), 0)
  // Nothing due or planned today: the plan and deadlines already say so.
  if (todays.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Due today</CardTitle>
        <CardDescription>
          {remaining.length > 0
            ? `${remaining.length} to go · about ${formatDuration(minutesLeft)} of work`
            : "Everything due today is done."}
        </CardDescription>
        <CardAction>
          <Link
            href="/tasks"
            className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            All tasks
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2">
        <ul className="divide-y">
          {todays.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
