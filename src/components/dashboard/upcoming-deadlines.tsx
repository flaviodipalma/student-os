"use client"

import { CircleAlertIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCourses } from "@/lib/course-store"
import { formatRelativeDay, formatTime, fromDateKey } from "@/lib/format"
import { useTasks } from "@/lib/task-store"
import { daysUntilDue, typeLabel, upcomingDeadlines } from "@/lib/tasks"
import { cn } from "@/lib/utils"

// How close a deadline is: 0–1 days urgent, 2–3 days soon, later is calm.
function urgencyOf(daysLeft: number) {
  if (daysLeft <= 1) return { label: "Urgent", bar: "bg-red-500", text: "text-red-700" }
  if (daysLeft <= 3) return { label: "Soon", bar: "bg-amber-500", text: "text-amber-700" }
  return { label: null, bar: "bg-foreground/15", text: "text-muted-foreground" }
}

export function UpcomingDeadlines({ className }: { className?: string }) {
  const { tasks, today } = useTasks()
  const { getCourse } = useCourses()
  const deadlines = upcomingDeadlines(tasks, today).slice(0, 5)

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Upcoming deadlines</CardTitle>
        <CardDescription>What&apos;s due next across your courses</CardDescription>
      </CardHeader>
      <CardContent>
        {deadlines.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">No deadlines coming up.</p>
        )}
        <ul className="space-y-3">
          {deadlines.map((task) => {
            const course = getCourse(task.courseId)
            const urgency = urgencyOf(daysUntilDue(task, today))
            return (
              <li key={task.id} className="flex gap-3">
                <span aria-hidden className={cn("w-1 shrink-0 rounded-full", urgency.bar)} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium leading-snug">{task.title}</p>
                    <p className="shrink-0 text-right text-sm font-medium">
                      {formatRelativeDay(fromDateKey(task.dueDate), fromDateKey(today))}
                    </p>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2">
                      {course && <CourseTag code={course.code} color={course.color} />}
                      <span>{typeLabel[task.type]}</span>
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
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
