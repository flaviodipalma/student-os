"use client"

import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { courseColorClass } from "@/components/course-tag"
import { NewTaskButton } from "@/components/tasks/new-task-button"
import { TaskList } from "@/components/tasks/task-list"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useTasks } from "@/lib/task-store"
import { byDue, formatDue, isDone, tasksForCourse, upcomingDeadlines } from "@/lib/tasks"
import type { Course, Task, TaskType } from "@/lib/types"
import { cn } from "@/lib/utils"

// Open work is split into these groups; finished work goes to "Completed".
const groups: { title: string; types: TaskType[]; empty: string }[] = [
  { title: "Upcoming assignments", types: ["assignment"], empty: "No open assignments." },
  { title: "Exams & quizzes", types: ["exam", "quiz"], empty: "No exams or quizzes coming up." },
  { title: "Projects", types: ["project"], empty: "No open projects." },
  { title: "Other deadlines", types: ["reading", "lab", "study", "other"], empty: "Nothing else due." },
]

export function CourseDetail({ course }: { course: Course }) {
  const { tasks, today } = useTasks()
  const courseTasks = tasksForCourse(tasks, course.id)
  const open = courseTasks.filter((task) => !isDone(task)).sort(byDue)
  const completed = courseTasks.filter(isDone).sort((a, b) => byDue(b, a))
  const next = upcomingDeadlines(courseTasks, today)[0]

  return (
    <div className="space-y-6">
      <Link
        href="/courses"
        className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        All courses
      </Link>

      <header className="flex overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <span aria-hidden className={cn("w-1.5 shrink-0", courseColorClass[course.color])} />
        <div className="flex-1 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">{course.code}</p>
              <h1 className="mt-0.5 text-2xl font-semibold tracking-tight md:text-3xl">{course.name}</h1>
              <p className="mt-1 text-muted-foreground">{course.professor}</p>
            </div>
            <NewTaskButton courseId={course.id} label="Add task" />
          </div>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed">{course.description}</p>
          <dl className="mt-5 flex flex-wrap gap-x-10 gap-y-4 border-t pt-5 text-sm">
            <Stat label="Open tasks" value={String(open.length)} />
            <Stat label="Completed" value={String(completed.length)} />
            <div className="min-w-0">
              <dt className="text-muted-foreground">Next deadline</dt>
              <dd className="mt-0.5 text-lg font-semibold">
                {next ? (
                  <>
                    {next.title}
                    <span className="text-base font-normal text-muted-foreground">
                      {" "}
                      · {formatDue(next, today)}
                    </span>
                  </>
                ) : (
                  <span className="text-base font-normal text-muted-foreground">Nothing coming up</span>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </header>

      {groups.map((group) => (
        <TaskGroup
          key={group.title}
          title={group.title}
          tasks={open.filter((task) => group.types.includes(task.type))}
          empty={group.empty}
        />
      ))}
      <TaskGroup title="Completed" tasks={completed} empty="Nothing completed yet." />
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold">{value}</dd>
    </div>
  )
}

function TaskGroup({ title, tasks, empty }: { title: string; tasks: Task[]; empty: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold">
          {title}
          <span className="text-sm font-normal text-muted-foreground tabular-nums">{tasks.length}</span>
        </CardTitle>
        {/* Empty groups stay compact: just the title and a short note. */}
        {tasks.length === 0 && <CardDescription>{empty}</CardDescription>}
      </CardHeader>
      {tasks.length > 0 && (
        <CardContent className="px-2">
          <TaskList tasks={tasks} showCourse={false} />
        </CardContent>
      )}
    </Card>
  )
}
