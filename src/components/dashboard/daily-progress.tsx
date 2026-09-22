"use client"

import { Progress } from "@/components/ui/progress"
import { formatDuration } from "@/lib/format"
import { useTasks } from "@/lib/task-store"
import { isDone, todaysTasks } from "@/lib/tasks"
import { cn } from "@/lib/utils"

export function DailyProgress({ className }: { className?: string }) {
  const { tasks, today } = useTasks()
  const todays = todaysTasks(tasks, today)
  const done = todays.filter(isDone).length
  const minutesLeft = todays
    .filter((task) => !isDone(task))
    .reduce((sum, task) => sum + task.estimateMinutes, 0)
  const percent = todays.length === 0 ? 0 : Math.round((done / todays.length) * 100)

  return (
    <section
      aria-labelledby="progress-heading"
      className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}
    >
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="progress-heading" className="text-sm font-medium text-muted-foreground">
          Today&apos;s progress
        </h2>
        <p className="text-xs text-muted-foreground">
          {minutesLeft > 0 ? `${formatDuration(minutesLeft)} of work left` : "All done"}
        </p>
      </div>
      <p className="mt-2 text-sm">
        <span className="text-2xl font-semibold">{done}</span>
        <span className="text-muted-foreground"> of {todays.length} tasks completed</span>
      </p>
      <Progress
        value={percent}
        aria-label="Today's progress"
        className="mt-3 **:data-[slot=progress-track]:h-2"
      />
    </section>
  )
}
