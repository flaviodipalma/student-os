"use client"

import { useState } from "react"
import { CalendarClockIcon, CalendarRangeIcon, CheckIcon, LaptopIcon, PaletteIcon, PencilIcon, SchoolIcon, Trash2Icon } from "lucide-react"
import { courseColorClass } from "@/components/course-tag"
import { Field } from "@/components/form-fields"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { useAppStore } from "@/lib/app-store"
import { classTimesOf, likelySemesterEnd, likelySemesterStart } from "@/lib/class-times"
import { courseColors } from "@/lib/course-colors"
import type { Course, CourseColor } from "@/lib/types"
import { cn } from "@/lib/utils"
import { ClassTimesSteps } from "./class-times"

// The bar at the bottom of the Courses page in select mode: how many courses are
// selected, Edit (semester dates, online / in person, color, class times) and
// Delete. Every change applies to all the selected courses at once.

type Open = "delete" | "dates" | "online" | "color" | "classTimes" | null

const colorNames: Record<CourseColor, string> = { sky: "Blue", emerald: "Green", violet: "Purple", orange: "Orange", rose: "Pink" }

export function BulkCourseBar({ selected, onDeleted }: { selected: Course[]; onDeleted: () => void }) {
  const { tasks, recurringCommitments, bulkUpdateCourses } = useAppStore()
  const [open, setOpen] = useState<Open>(null)
  // The courses a window was opened for (kept while it's open).
  const [target, setTarget] = useState<Course[]>([])
  const ids = selected.map((course) => course.id)
  const none = selected.length === 0
  const count = `${selected.length} ${selected.length === 1 ? "course" : "courses"}`
  const taskCount = tasks.filter((task) => ids.includes(task.courseId)).length
  const withClassTimes = selected.filter((course) => classTimesOf(recurringCommitments, course.id).length > 0).length

  const show = (what: Open) => {
    setTarget(selected)
    setOpen(what)
  }
  const close = () => setOpen(null)

  return (
    <>
      {/* Above the phone tab bar; centered over the page on larger screens. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-40 flex justify-center px-4 lg:bottom-6 lg:pl-64">
        <div
          role="toolbar"
          aria-label="Selected courses"
          className="pointer-events-auto flex w-full max-w-lg items-center gap-2 rounded-xl bg-card px-4 py-2.5 shadow-lg ring-1 ring-border"
        >
          <p className="flex-1 text-sm font-medium" aria-live="polite">
            {none ? "Select courses" : `${count} selected`}
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" disabled={none} />}>
              <PencilIcon data-icon="inline-start" />
              Edit
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onClick={() => show("dates")}>
                <CalendarRangeIcon />
                Semester dates
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => show("classTimes")}>
                <CalendarClockIcon />
                Add class times
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => (withClassTimes > 0 ? show("online") : void bulkUpdateCourses(ids, { kind: "online", online: true }))}>
                <LaptopIcon />
                Mark as online
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void bulkUpdateCourses(ids, { kind: "online", online: false })}>
                <SchoolIcon />
                Mark as in person
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => show("color")}>
                <PaletteIcon />
                Color
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="destructive" disabled={none} onClick={() => show("delete")}>
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        </div>
      </div>

      <AlertDialog open={open === "delete"} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {count}?</AlertDialogTitle>
            <AlertDialogDescription>
              {taskCount > 0
                ? `This also deletes their ${taskCount} ${taskCount === 1 ? "task" : "tasks"}, study sessions and class times. This can't be undone.`
                : "Their class times go too. This can't be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={async () => {
                close()
                if (await bulkUpdateCourses(target.map((course) => course.id), { kind: "delete" })) onDeleted()
              }}
            >
              Delete {count}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={open === "online"} onOpenChange={(next) => !next && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark {count} as online?</AlertDialogTitle>
            <AlertDialogDescription>
              Online courses have no class meetings, so the class times of {withClassTimes}{" "}
              {withClassTimes === 1 ? "course" : "courses"} come off your calendar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                close()
                void bulkUpdateCourses(target.map((course) => course.id), { kind: "online", online: true })
              }}
            >
              Mark as online
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open === "dates"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Semester dates</DialogTitle>
            <DialogDescription>
              The first and last day of classes for {target.length === 1 ? "this course" : `these ${target.length} courses`}.
              Their class times show on your calendar between these days.
            </DialogDescription>
          </DialogHeader>
          {open === "dates" && <DatesForm courses={target} onDone={close} />}
        </DialogContent>
      </Dialog>

      <Dialog open={open === "color"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Color</DialogTitle>
            <DialogDescription>For {target.length === 1 ? "this course" : `these ${target.length} courses`}.</DialogDescription>
          </DialogHeader>
          <div role="group" aria-label="Colors" className="flex flex-wrap gap-3">
            {courseColors.map((color) => {
              const current = target.length > 0 && target.every((course) => course.color === color)
              return (
                <button
                  key={color}
                  type="button"
                  aria-label={colorNames[color]}
                  aria-pressed={current}
                  onClick={() => {
                    close()
                    void bulkUpdateCourses(target.map((course) => course.id), { kind: "color", color })
                  }}
                  className={cn(
                    "flex size-10 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                    courseColorClass[color],
                    current && "ring-2 ring-foreground"
                  )}
                >
                  {current && <CheckIcon className="size-4" />}
                </button>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={open === "classTimes"} onOpenChange={(next) => !next && close()}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add class times</DialogTitle>
            <DialogDescription>One course at a time. Online courses are left out.</DialogDescription>
          </DialogHeader>
          {open === "classTimes" &&
            (target.some((course) => !course.online) ? (
              <ClassTimesSteps courses={target.filter((course) => !course.online)} onDone={close} />
            ) : (
              <p className="text-sm text-muted-foreground">All the selected courses are online, so they have no class times.</p>
            ))}
        </DialogContent>
      </Dialog>
    </>
  )
}

function DatesForm({ courses, onDone }: { courses: Course[]; onDone: () => void }) {
  const { today, recurringCommitments, bulkUpdateCourses } = useAppStore()
  // Start from what the first course already has: its class times, its semester, or a guess.
  const first = courses[0]
  const saved = first ? classTimesOf(recurringCommitments, first.id).find((time) => time.startDate && time.endDate) : undefined
  const [from, setFrom] = useState(saved?.startDate ?? first?.termStart ?? likelySemesterStart(today))
  const [until, setUntil] = useState(saved?.endDate ?? first?.termEnd ?? likelySemesterEnd(today))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!from || !until) return setError("Pick both days.")
    if (until < from) return setError("The last day can't be before the first day.")
    setSaving(true)
    const ok = await bulkUpdateCourses(
      courses.map((course) => course.id),
      { kind: "dates", from, until }
    )
    setSaving(false)
    if (ok) onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="First day of classes" htmlFor="bulk-dates-from">
          <Input id="bulk-dates-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Last day of classes" htmlFor="bulk-dates-until">
          <Input id="bulk-dates-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
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
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save dates"}
        </Button>
      </DialogFooter>
    </form>
  )
}
