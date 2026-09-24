"use client"

import Link from "next/link"
import { ChevronRightIcon, CircleAlertIcon } from "lucide-react"
import { courseColorClass } from "@/components/course-tag"
import { useAppStore } from "@/lib/app-store"
import { formatDuration } from "@/lib/format"
import { completedMinutesFor } from "@/lib/planner"
import { useTasks } from "@/lib/task-store"
import { courseWorkload, formatDue, isDone, tasksForCourse, upcomingDeadlines } from "@/lib/tasks"
import type { Course } from "@/lib/types"
import { cn } from "@/lib/utils"

export function CourseCard({ course }: { course: Course }) {
  const { tasks, today } = useTasks()
  const courseTasks = tasksForCourse(tasks, course.id)
  const open = courseTasks.filter((task) => !isDone(task)).length
  const next = upcomingDeadlines(courseTasks, today)[0]
  const { calendarItems } = useAppStore()
  const workload = courseWorkload(courseTasks, today, (taskId) => completedMinutesFor(taskId, calendarItems))

  return (
    <Link
      href={`/courses/${course.id}`}
      className="group flex overflow-hidden rounded-xl bg-card ring-1 ring-border transition-shadow outline-none hover:shadow-md hover:ring-foreground/15 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span aria-hidden className={cn("w-1.5 shrink-0", courseColorClass[course.color])} />
      <div className="flex min-w-0 flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
              {course.code}
              {workload.overdue > 0 && (
                // Needs attention: said in words and with an icon, not only color.
                <span className="inline-flex items-center gap-1 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger ring-1 ring-danger-border">
                  <CircleAlertIcon aria-hidden className="size-3.5" />
                  {workload.overdue} overdue
                </span>
              )}
            </p>
            <h2 className="mt-0.5 text-lg font-semibold leading-snug">{course.name}</h2>
            {course.professor && <p className="mt-0.5 text-sm text-muted-foreground">{course.professor}</p>}
          </div>
          <ChevronRightIcon
            aria-hidden
            className="mt-1 size-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          />
        </div>
        <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{course.description}</p>
        <dl className="mt-4 flex gap-6 border-t pt-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Open tasks</dt>
            <dd className="mt-0.5 text-lg font-semibold leading-6">{open}</dd>
          </div>
          {workload.minutesLeft > 0 && (
            <div>
              <dt className="text-muted-foreground">Work left</dt>
              <dd className="mt-0.5 text-lg font-semibold leading-6">~{formatDuration(workload.minutesLeft)}</dd>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <dt className="text-muted-foreground">Next deadline</dt>
            <dd className="mt-0.5 truncate leading-6 font-medium">
              {next ? (
                <>
                  {next.title}
                  <span className="font-normal text-muted-foreground"> · {formatDue(next, today)}</span>
                </>
              ) : (
                <span className="font-normal text-muted-foreground">Nothing coming up</span>
              )}
            </dd>
          </div>
        </dl>
      </div>
    </Link>
  )
}
