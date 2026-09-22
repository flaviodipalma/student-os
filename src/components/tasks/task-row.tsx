"use client"

import { CalendarIcon, ClockIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { Checkbox } from "@/components/ui/checkbox"
import { getCourse } from "@/lib/data/courses"
import { useTasks } from "@/lib/task-store"
import { formatDue, formatEstimate, isDone, isOverdue } from "@/lib/tasks"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"
import { InProgressBadge, PriorityBadge } from "./task-badges"

// One task, laid out to answer: what is it, when is it due, how important,
// how long will it take, and is it done?
export function TaskRow({
  task,
  showCourse = true,
  showDescription = false,
  actions,
}: {
  task: Task
  showCourse?: boolean
  showDescription?: boolean
  actions?: React.ReactNode
}) {
  const { today, setStatus } = useTasks()
  const course = getCourse(task.courseId)
  const done = isDone(task)
  const overdue = isOverdue(task, today)
  const checkboxId = `task-${task.id}`

  return (
    <div className="flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/40">
      <Checkbox
        id={checkboxId}
        checked={done}
        onCheckedChange={(checked) => setStatus(task.id, checked ? "completed" : "not_started")}
        className="mt-0.5 size-5 rounded-md"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <label
            htmlFor={checkboxId}
            className={cn(
              "cursor-pointer font-medium leading-snug",
              done && "text-muted-foreground line-through decoration-muted-foreground/50"
            )}
          >
            {task.title}
          </label>
          <div className="-my-1 flex shrink-0 items-center gap-1">
            {!done && <PriorityBadge priority={task.priority} />}
            {actions}
          </div>
        </div>
        {showDescription && task.description && (
          <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{task.description}</p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {showCourse && course && <CourseTag code={course.code} color={course.color} />}
          <span className={cn("inline-flex items-center gap-1", overdue && "font-medium text-red-700")}>
            <CalendarIcon aria-hidden className="size-3.5" />
            {overdue ? `Overdue · was due ${formatDue(task, today)}` : `Due ${formatDue(task, today)}`}
          </span>
          <span className="inline-flex items-center gap-1">
            <ClockIcon aria-hidden className="size-3.5" />
            {formatEstimate(task.estimateMinutes)}
          </span>
          {task.status === "in_progress" && <InProgressBadge />}
        </div>
      </div>
    </div>
  )
}
