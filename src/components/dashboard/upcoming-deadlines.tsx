"use client"

import Link from "next/link"
import { CircleAlertIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { PriorityBadge } from "@/components/tasks/task-badges"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCourses } from "@/lib/course-store"
import { useAppStore } from "@/lib/app-store"
import { formatDuration, formatRelativeDay, formatTime, fromDateKey } from "@/lib/format"
import { completedMinutesFor } from "@/lib/planner"
import { usePlan } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import { daysUntilDue, isOverdue, typeLabel, upcomingDeadlines } from "@/lib/tasks"
import { cn } from "@/lib/utils"

// How close a deadline is: overdue, 0–1 days urgent, 2–3 days soon, later is calm.
function urgencyOf(daysLeft: number) {
  if (daysLeft < 0) return { label: "Overdue", bar: "bg-red-600", text: "text-red-700" }
  if (daysLeft <= 1) return { label: "Urgent", bar: "bg-red-500", text: "text-red-700" }
  if (daysLeft <= 3) return { label: "Soon", bar: "bg-amber-500", text: "text-amber-700" }
  return { label: null, bar: "bg-foreground/15", text: "text-muted-foreground" }
}

export function UpcomingDeadlines({ className }: { className?: string }) {
  const { tasks, today } = useTasks()
  const { getCourse } = useCourses()
  const { calendarItems } = useAppStore()
  const plan = usePlan(today)
  // Most urgent first, in the Planner's own order (deadline, priority, work left,
  // time available); anything it isn't ranking today follows by due date.
  const rank = new Map(plan.ranked.map((scored, index) => [scored.task.id, index]))
  const overdue = tasks.filter((task) => isOverdue(task, today) && task.type !== "study")
  const deadlines = [...overdue, ...upcomingDeadlines(tasks, today)]
    .map((task, index) => ({ task, index }))
    .sort((a, b) => (rank.get(a.task.id) ?? Infinity) - (rank.get(b.task.id) ?? Infinity) || a.index - b.index)
    .map(({ task }) => task)
    .slice(0, 5)
  const workLeft = (taskId: string, estimate: number | null) =>
    estimate === null ? null : Math.max(0, estimate - completedMinutesFor(taskId, calendarItems))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Upcoming deadlines</CardTitle>
        <CardDescription>Most urgent first, across your courses</CardDescription>
      </CardHeader>
      <CardContent>
        {deadlines.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">No deadlines coming up.</p>
        )}
        <ul className="space-y-3">
          {deadlines.map((task) => {
            const course = getCourse(task.courseId)
            const urgency = urgencyOf(daysUntilDue(task, today))
            const left = workLeft(task.id, task.estimateMinutes)
            return (
              <li key={task.id}>
                <Link
                  href={`/tasks?task=${task.id}`}
                  className="-mx-2 flex gap-3 rounded-lg px-2 py-1 outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span aria-hidden className={cn("w-1 shrink-0 rounded-full", urgency.bar)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-medium leading-snug">{task.title}</p>
                      <p className="shrink-0 text-right text-sm font-medium">
                        {formatRelativeDay(fromDateKey(task.dueDate), fromDateKey(today))}
                      </p>
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                      <span className="flex flex-wrap items-center gap-2">
                        {course && <CourseTag code={course.code} color={course.color} />}
                        <span>{typeLabel[task.type]}</span>
                        {(task.priority === "high" || task.priority === "critical") && <PriorityBadge priority={task.priority} />}
                        {left !== null && left > 0 && <span>~{formatDuration(left)} left</span>}
                      </span>
                      {urgency.label ? (
                        <span className={cn("inline-flex items-center gap-1 font-medium", urgency.text)}>
                          <CircleAlertIcon aria-hidden className="size-3.5" />
                          {urgency.label}
                        </span>
                      ) : (
                        <span>
                          {task.dueTime ? formatTime(fromDateKey(task.dueDate, task.dueTime)) : "End of day"}
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
