"use client"

import { Progress } from "@/components/ui/progress"
import { toMinutes } from "@/lib/events"
import { formatDuration } from "@/lib/format"
import { usePlan } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import { isDone, todaysTasks } from "@/lib/tasks"
import { cn } from "@/lib/utils"

// Today's progress: study done against today's plan (from the same DailyPlan as
// the Planner), plus tasks due today. Completing a study session moves the bar.
export function DailyProgress({ className }: { className?: string }) {
  const { tasks, today } = useTasks()
  const plan = usePlan(today)
  const minutes = (s: { startTime: string; endTime: string }) => toMinutes(s.endTime) - toMinutes(s.startTime)
  const sessions = [...plan.existingSessions, ...plan.suggestions]
  const planned = sessions.reduce((sum, s) => sum + minutes(s), 0)
  const done = plan.existingSessions.filter((s) => s.status === "completed").reduce((sum, s) => sum + minutes(s), 0)
  const percent = planned === 0 ? 0 : Math.round((done / planned) * 100)
  const dueToday = todaysTasks(tasks, today)
  const dueDone = dueToday.filter(isDone).length

  return (
    <section
      aria-labelledby="progress-heading"
      className={cn("rounded-xl bg-card p-4 ring-1 ring-foreground/10", className)}
    >
      <h2 id="progress-heading" className="text-sm font-medium text-muted-foreground">
        Today&apos;s progress
      </h2>
      {planned > 0 ? (
        <>
          <p className="mt-2 text-sm">
            <span className="text-2xl font-semibold">{formatDuration(done)}</span>
            <span className="text-muted-foreground"> of {formatDuration(planned)} study done</span>
          </p>
          <Progress
            value={percent}
            aria-label={`${percent}% of today's study done`}
            className="mt-3 **:data-[slot=progress-track]:h-2"
          />
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">No study planned for today.</p>
      )}
      {dueToday.length > 0 && (
        <p className="mt-2 text-xs text-muted-foreground">
          {dueDone} of {dueToday.length} {dueToday.length === 1 ? "task" : "tasks"} due today done
        </p>
      )}
    </section>
  )
}
