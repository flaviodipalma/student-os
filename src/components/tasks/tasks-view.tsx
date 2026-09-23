"use client"

import { useState } from "react"
import { Card, CardContent } from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCourses } from "@/lib/course-store"
import { useTasks } from "@/lib/task-store"
import { byCourse, byDue, byPriority, isDone } from "@/lib/tasks"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"
import { NewTaskButton } from "./new-task-button"
import { TaskList } from "./task-list"

type Filter = "all" | "today" | "upcoming" | "completed"
type Sort = "due" | "priority" | "course"

const filters: { value: Filter; label: string; empty: string; test: (task: Task, today: string) => boolean }[] = [
  { value: "all", label: "All", empty: "No tasks yet.", test: () => true },
  {
    value: "today",
    label: "Today",
    empty: "Nothing due or planned for today.",
    test: (task, today) => task.dueDate === today || task.plannedDate === today,
  },
  { value: "upcoming", label: "Upcoming", empty: "You're all caught up.", test: (task) => !isDone(task) },
  { value: "completed", label: "Completed", empty: "Nothing completed yet.", test: isDone },
]

const sorts = [
  { value: "due", label: "Due date" },
  { value: "priority", label: "Priority" },
  { value: "course", label: "Course" },
] as const

export function TasksView() {
  const { tasks, today } = useTasks()
  const { courses } = useCourses()
  const compare: Record<Sort, (a: Task, b: Task) => number> = {
    due: byDue,
    priority: byPriority,
    course: byCourse(courses),
  }
  const [filter, setFilter] = useState<Filter>("upcoming")
  const [sort, setSort] = useState<Sort>("due")

  const active = filters.find((f) => f.value === filter)!
  const visible = tasks
    .filter((task) => active.test(task, today))
    // Finished tasks sink to the bottom, the rest follow the chosen sort.
    .sort((a, b) => Number(isDone(a)) - Number(isDone(b)) || compare[sort](a, b))

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Show" className="inline-flex rounded-lg bg-muted p-1">
          {filters.map((f) => {
            const count = tasks.filter((task) => f.test(task, today)).length
            const selected = f.value === filter
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(f.value)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 max-sm:py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  selected
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {f.label}
                <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          <span id="sort-label" className="text-sm text-muted-foreground">
            Sort by
          </span>
          <Select items={sorts} value={sort} onValueChange={(value) => value && setSort(value as Sort)}>
            <SelectTrigger aria-labelledby="sort-label" className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {sorts.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="px-2">
          {tasks.length === 0 ? (
            // A brand-new student: say so, and offer the way in.
            <div className="px-2 py-8 text-center">
              <p className="font-medium">No tasks yet.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add your first task, or import a syllabus to add all its deadlines at once.
              </p>
              <div className="mt-4 flex justify-center">
                <NewTaskButton label="Create task" />
              </div>
            </div>
          ) : (
            <TaskList tasks={visible} emptyMessage={active.empty} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
