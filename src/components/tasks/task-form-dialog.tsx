"use client"

import { useState } from "react"
import { Field, SimpleSelect, useFieldErrors, type Option } from "@/components/form-fields"
import Link from "next/link"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useCourses } from "@/lib/course-store"
import { addDays } from "@/lib/format"
import { useTasks } from "@/lib/task-store"
import { priorities, priorityLabel, statusLabel, typeLabel } from "@/lib/tasks"
import type { Priority, Task, TaskInput, TaskStatus, TaskType } from "@/lib/types"
import { taskInputSchema } from "@/lib/validation"

const typeOptions = Object.entries(typeLabel).map(([value, label]) => ({ value, label })) as Option<TaskType>[]
const priorityOptions = priorities.map((value) => ({ value, label: priorityLabel[value] }))
const statusOptions = Object.entries(statusLabel).map(([value, label]) => ({ value, label })) as Option<TaskStatus>[]

// Create a task (no `task`) or edit one (pass `task`).
export function TaskFormDialog({
  open,
  onOpenChange,
  task,
  defaultCourseId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  task?: Task
  defaultCourseId?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{task ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {task ? "Update the details of this task." : "Add something you need to get done."}
          </DialogDescription>
        </DialogHeader>
        <TaskForm task={task} defaultCourseId={defaultCourseId} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function TaskForm({
  task,
  defaultCourseId,
  onDone,
}: {
  task?: Task
  defaultCourseId?: string
  onDone: () => void
}) {
  const { today, addTask, updateTask } = useTasks()
  const { courses } = useCourses()
  const courseOptions = courses.map((course) => ({ value: course.id, label: `${course.code} · ${course.name}` }))
  const [title, setTitle] = useState(task?.title ?? "")
  const [description, setDescription] = useState(task?.description ?? "")
  const [courseId, setCourseId] = useState(task?.courseId ?? defaultCourseId ?? courses[0]?.id ?? "")
  const [type, setType] = useState<TaskType>(task?.type ?? "assignment")
  const [dueDate, setDueDate] = useState(task?.dueDate ?? addDays(today, 1))
  const [dueTime, setDueTime] = useState(task?.dueTime ?? "")
  const [priority, setPriority] = useState<Priority>(task?.priority ?? "medium")
  const [estimate, setEstimate] = useState(String(task?.estimateMinutes ?? 60))
  const [status, setStatus] = useState<TaskStatus>(task?.status ?? "not_started")
  const [error, setError] = useState<string | null>(null)
  const fields = useFieldErrors({
    title: "task-title",
    courseId: "task-course",
    dueDate: "task-due-date",
    dueTime: "task-due-time",
    estimateMinutes: "task-estimate",
  })
  // Update a value and clear its message.
  const edit =
    <T,>(setter: (value: T) => void, key?: Parameters<typeof fields.clear>[0]) =>
    (value: T) => {
      setter(value)
      if (key) fields.clear(key)
    }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // The same rules the server checks (src/lib/validation.ts).
    const parsed = taskInputSchema.safeParse({
      title,
      description,
      courseId,
      type,
      dueDate,
      dueTime: dueTime || undefined,
      priority,
      estimateMinutes: estimate.trim() === "" ? NaN : Number(estimate),
      status,
      plannedDate: task?.plannedDate,
    })
    if (!parsed.success) return setError(fields.show(parsed.error))
    fields.reset()
    const input: TaskInput = parsed.data
    if (task) updateTask(task.id, input)
    else addTask(input)
    onDone()
  }

  // Every task belongs to a course, so a brand-new student adds a course first.
  if (courses.length === 0) {
    return (
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Tasks belong to a course. Add your first course, or import a syllabus, then come back to add tasks.
        </p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>
            Close
          </Button>
          <Link href="/courses" className={buttonVariants()} onClick={onDone}>
            Go to Courses
          </Link>
        </DialogFooter>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <Field label="Title" htmlFor="task-title" error={fields.errors.title}>
        <Input
          id="task-title"
          value={title}
          onChange={(e) => edit(setTitle, "title")(e.target.value)}
          placeholder="e.g. Assignment #3: Binary Trees"
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="task-description" optional>
        <Textarea
          id="task-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Notes, instructions, links…"
          rows={2}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Course" htmlFor="task-course" error={fields.errors.courseId}>
          <SimpleSelect id="task-course" value={courseId} onChange={setCourseId} options={courseOptions} />
        </Field>
        <Field label="Type" htmlFor="task-type">
          <SimpleSelect id="task-type" value={type} onChange={setType} options={typeOptions} />
        </Field>
        <Field label="Due date" htmlFor="task-due-date" error={fields.errors.dueDate}>
          <Input id="task-due-date" type="date" value={dueDate} onChange={(e) => edit(setDueDate, "dueDate")(e.target.value)} />
        </Field>
        <Field label="Due time" htmlFor="task-due-time" optional error={fields.errors.dueTime}>
          <Input id="task-due-time" type="time" value={dueTime} onChange={(e) => edit(setDueTime, "dueTime")(e.target.value)} />
        </Field>
        <Field label="Priority" htmlFor="task-priority">
          <SimpleSelect id="task-priority" value={priority} onChange={setPriority} options={priorityOptions} />
        </Field>
        <Field label="Estimated duration (minutes)" htmlFor="task-estimate" error={fields.errors.estimateMinutes}>
          <Input
            id="task-estimate"
            type="number"
            inputMode="numeric"
            min={5}
            step={5}
            value={estimate}
            onChange={(e) => edit(setEstimate, "estimateMinutes")(e.target.value)}
          />
        </Field>
        <Field label="Status" htmlFor="task-status">
          <SimpleSelect id="task-status" value={status} onChange={setStatus} options={statusOptions} />
        </Field>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{task ? "Save changes" : "Add task"}</Button>
      </DialogFooter>
    </form>
  )
}
