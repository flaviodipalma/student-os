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
  const minutesLeft = remaining.reduce((sum, task) => sum + task.estimateMinutes, 0)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Today&apos;s priorities</CardTitle>
        <CardDescription>
          {todays.length === 0
            ? "Nothing planned or due today."
            : remaining.length > 0
              ? `${remaining.length} to go · about ${formatDuration(minutesLeft)} of focused work`
              : "Everything planned for today is done."}
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
