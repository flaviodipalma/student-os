"use client"

import { useState } from "react"
import { CalendarClockIcon, LaptopIcon, MapPinIcon, PencilIcon, PlusIcon, XIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { Field } from "@/components/form-fields"
import { DayPicker } from "@/components/preferences/commitments-editor"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useAppStore } from "@/lib/app-store"
import { markCoursesAsked, useAskedCourseIds } from "@/lib/class-times-asked"
import { classTimesOf, likelySemesterEnd, likelySemesterStart } from "@/lib/class-times"
import { formatTime, fromDateKey } from "@/lib/format"
import { formatDays } from "@/lib/recurring"
import { lmsProviderNames, type ClassTimeInput, type Course, type RecurringCommitment } from "@/lib/types"
import { classTimesSchema, firstIssue } from "@/lib/validation"

// A course's class times: when and where it meets each week (one or more times,
// e.g. a lecture Mon/Wed/Fri and a lab on Tuesday). They're "class" recurring
// commitments, so they show on the calendar and the Planner keeps them free. They
// run for the whole semester (back to its first day), from the LMS's term dates or
// a best guess. An online course has none.
//
// - ClassTimesFields: the editor (used by the forms below and the course form)
// - ClassTimesCard: on the course page
// - ClassTimesSteps: one course at a time, after courses come in (onboarding, the notice)
// - ClassTimesNotice: "N courses aren't on your calendar yet" (Dashboard, Courses)

// ---- The editor --------------------------------------------------------------------------

export type ClassTimeRow = {
  key: string
  daysOfWeek: number[]
  startTime: string
  endTime: string
  location: string
}
// `from` / `until`: the semester's first and last day (shared by the course's class
// times). `datesFrom`: where those came from, for the hint under them.
export type ClassTimesDraft = { rows: ClassTimeRow[]; from: string; until: string; datesFrom: "saved" | "lms" | "guess" }

let rowCount = 0
export const newClassTimeRow = (): ClassTimeRow => ({
  key: `class-time-${++rowCount}`,
  daysOfWeek: [],
  startTime: "09:00",
  endTime: "09:50",
  location: "",
})

// The course's saved class times as a draft. The dates: the saved ones, else the
// course's semester from the LMS, else a guess for the current semester.
export function draftFrom(times: RecurringCommitment[], today: string, course?: Course, blankRow = false): ClassTimesDraft {
  const rows = times.map((time) => ({
    key: `class-time-${++rowCount}`,
    daysOfWeek: time.daysOfWeek,
    startTime: time.startTime,
    endTime: time.endTime,
    location: time.location ?? "",
  }))
  const saved = times.find((time) => time.startDate || time.endDate)
  const lms = course?.termStart && course.termEnd ? { from: course.termStart, until: course.termEnd } : null
  const dates = saved
    ? { from: saved.startDate ?? "", until: saved.endDate ?? "", datesFrom: "saved" as const }
    : lms
      ? { ...lms, datesFrom: "lms" as const }
      : { from: likelySemesterStart(today), until: likelySemesterEnd(today), datesFrom: "guess" as const }
  return { rows: rows.length === 0 && blankRow ? [newClassTimeRow()] : rows, ...dates }
}

// The draft as the server takes it, or the first problem (e.g. "Class time 2: Pick at least one day.").
export function checkDraft(draft: ClassTimesDraft): { ok: true; times: ClassTimeInput[] } | { ok: false; error: string } {
  const times = draft.rows.map((row) => ({
    daysOfWeek: [...row.daysOfWeek].sort((a, b) => a - b),
    startTime: row.startTime,
    endTime: row.endTime,
    location: row.location.trim() || undefined,
    startDate: draft.from || undefined,
    endDate: draft.until || undefined,
  }))
  const parsed = classTimesSchema.safeParse(times)
  if (parsed.success) return { ok: true, times: parsed.data }
  const index = parsed.error.issues[0]?.path[0]
  const prefix = typeof index === "number" && draft.rows.length > 1 ? `Class time ${index + 1}: ` : ""
  return { ok: false, error: prefix + firstIssue(parsed.error) }
}

export function ClassTimesFields({
  id,
  value,
  onChange,
  course,
}: {
  id: string
  value: ClassTimesDraft
  onChange: (draft: ClassTimesDraft) => void
  // For the dates' hint ("From your Canvas semester").
  course?: Course
}) {
  const setRow = (key: string, changes: Partial<ClassTimeRow>) =>
    onChange({ ...value, rows: value.rows.map((row) => (row.key === key ? { ...row, ...changes } : row)) })

  return (
    <div className="grid gap-3">
      {value.rows.map((row, index) => (
        <fieldset key={row.key} className="relative grid gap-4 rounded-lg border p-4">
          <legend className="sr-only">Class time {index + 1}</legend>
          {value.rows.length > 1 && <p className="-mb-1 text-xs font-medium text-muted-foreground">Class time {index + 1}</p>}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute top-2 right-2"
            aria-label={`Remove class time ${index + 1}`}
            onClick={() => onChange({ ...value, rows: value.rows.filter((other) => other.key !== row.key) })}
          >
            <XIcon />
          </Button>
          <DayPicker id={`${id}-${row.key}-days`} value={row.daysOfWeek} onChange={(daysOfWeek) => setRow(row.key, { daysOfWeek })} />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-[8rem_8rem_minmax(0,1fr)]">
            <Field label="Starts" htmlFor={`${id}-${row.key}-start`}>
              <Input
                id={`${id}-${row.key}-start`}
                type="time"
                value={row.startTime}
                onChange={(e) => setRow(row.key, { startTime: e.target.value })}
              />
            </Field>
            <Field label="Ends" htmlFor={`${id}-${row.key}-end`}>
              <Input
                id={`${id}-${row.key}-end`}
                type="time"
                value={row.endTime}
                onChange={(e) => setRow(row.key, { endTime: e.target.value })}
              />
            </Field>
            <div className="col-span-2 sm:col-span-1">
              <Field label="Room" htmlFor={`${id}-${row.key}-room`} optional>
                <Input
                  id={`${id}-${row.key}-room`}
                  placeholder="e.g. Tator Hall 120"
                  maxLength={100}
                  value={row.location}
                  onChange={(e) => setRow(row.key, { location: e.target.value })}
                />
              </Field>
            </div>
          </div>
        </fieldset>
      ))}

      <Button
        type="button"
        variant="outline"
        className="w-fit"
        onClick={() => onChange({ ...value, rows: [...value.rows, newClassTimeRow()] })}
      >
        <PlusIcon data-icon="inline-start" />
        {value.rows.length === 0 ? "Add class time" : "Add another time (lab, discussion…)"}
      </Button>

      {value.rows.length > 0 && (
        <div className="grid gap-1.5">
          <div className="grid grid-cols-2 gap-4 sm:max-w-md">
            <Field label="First day of classes" htmlFor={`${id}-from`}>
              <Input id={`${id}-from`} type="date" value={value.from} onChange={(e) => onChange({ ...value, from: e.target.value })} />
            </Field>
            <Field label="Last day of classes" htmlFor={`${id}-until`}>
              <Input id={`${id}-until`} type="date" value={value.until} onChange={(e) => onChange({ ...value, until: e.target.value })} />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            {value.datesFrom === "lms" && course?.source
              ? `Your semester's dates from ${lmsProviderNames[course.source.provider]}.`
              : value.datesFrom === "guess"
                ? "Our best guess for this semester. Change them if yours starts or ends on other days."
                : "Your classes show on the calendar every week between these days."}
          </p>
        </div>
      )}
    </div>
  )
}

// "Mon, Wed, Fri · 10:00 – 10:50 AM"
const clock = (hhmm: string) => formatTime(fromDateKey("2000-01-01", hhmm))
export const describeClassTime = (time: Pick<RecurringCommitment, "daysOfWeek" | "startTime" | "endTime">) =>
  `${formatDays(time.daysOfWeek)} · ${clock(time.startTime)} – ${clock(time.endTime)}`
const shortDate = (key: string) => fromDateKey(key).toLocaleDateString("en-US", { month: "short", day: "numeric" })

// ---- On the course page ----------------------------------------------------------------------

export function ClassTimesCard({ course }: { course: Course }) {
  const { recurringCommitments } = useAppStore()
  const times = classTimesOf(recurringCommitments, course.id)
  const [editing, setEditing] = useState(false)
  const until = times.find((time) => time.endDate)?.endDate
  const from = times.find((time) => time.startDate)?.startDate

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <CalendarClockIcon aria-hidden className="size-4 text-muted-foreground" />
            Class times
          </CardTitle>
          <CardDescription className="mt-1">
            {course.online ? (
              <span className="flex items-center gap-1.5">
                <LaptopIcon aria-hidden className="size-3.5" />
                Online course: no class meetings.
              </span>
            ) : times.length === 0 ? (
              "No class times yet. This course isn't on your calendar, and the Planner may schedule study time during class."
            ) : (
              `On your calendar every week${from && until ? `, ${shortDate(from)} – ${shortDate(until)}` : until ? ` until ${shortDate(until)}` : ""}. The Planner keeps these times free.`
            )}
          </CardDescription>
        </div>
        <Button variant={times.length === 0 && !course.online ? "default" : "outline"} size="sm" onClick={() => setEditing(true)}>
          {times.length === 0 && !course.online ? <PlusIcon data-icon="inline-start" /> : <PencilIcon data-icon="inline-start" />}
          {times.length === 0 && !course.online ? "Add class times" : "Edit"}
        </Button>
      </CardHeader>
      {times.length > 0 && (
        <CardContent>
          <ul className="grid gap-2">
            {times.map((time) => (
              <li key={time.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-lg bg-muted/60 px-3 py-2 text-sm">
                <span className="font-medium">{describeClassTime(time)}</span>
                {time.location && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <MapPinIcon aria-hidden className="size-3.5" />
                    {time.location}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      )}
      <ClassTimesDialog course={course} open={editing} onOpenChange={setEditing} />
    </Card>
  )
}

export function ClassTimesDialog({
  course,
  open,
  onOpenChange,
}: {
  course: Course
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Class times · {course.code}</DialogTitle>
          <DialogDescription>When {course.name} meets each week. Add a time for each lecture, lab or section.</DialogDescription>
        </DialogHeader>
        {open && <ClassTimesEditForm course={course} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  )
}

function ClassTimesEditForm({ course, onDone }: { course: Course; onDone: () => void }) {
  const { today, recurringCommitments, setClassTimes } = useAppStore()
  const [draft, setDraft] = useState(() => draftFrom(classTimesOf(recurringCommitments, course.id), today, course, true))
  const [online, setOnline] = useState(course.online ?? false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const checked = online ? { ok: true as const, times: [] as ClassTimeInput[] } : checkDraft(draft)
    if (!checked.ok) return setError(checked.error)
    setSaving(true)
    const result = await setClassTimes(course.id, checked.times, { online })
    setSaving(false)
    if (!result.ok) return setError(result.error)
    markCoursesAsked([course.id])
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <OnlineChoice id={`class-times-${course.id}-online`} checked={online} onChange={setOnline} />
      {!online && <ClassTimesFields id={`class-times-${course.id}`} value={draft} onChange={setDraft} course={course} />}
      {!online && draft.rows.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Saving with no class times takes {course.code} off your calendar.
        </p>
      )}
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
          {saving ? "Saving…" : "Save class times"}
        </Button>
      </DialogFooter>
    </form>
  )
}

// ---- One course at a time ----------------------------------------------------------------------

// Asks for each course's class times in turn: "Save and next", or "Skip" (after a
// warning that the course won't be on the calendar). `onDone` runs after the last one.
export function ClassTimesSteps({ courses, onDone }: { courses: Course[]; onDone: () => void }) {
  const { today, setClassTimes } = useAppStore()
  // The list is fixed when the steps start (saving changes which courses lack times).
  const [queue] = useState(courses)
  const [index, setIndex] = useState(0)
  const [draft, setDraft] = useState(() => draftFrom([], today, courses[0], true))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmSkip, setConfirmSkip] = useState(false)
  const course = queue[index]
  if (!course) return null
  const last = index === queue.length - 1

  function next() {
    markCoursesAsked([course.id])
    setError(null)
    setConfirmSkip(false)
    if (last) return onDone()
    setIndex(index + 1)
    setDraft(draftFrom([], today, queue[index + 1], true))
    window.scrollTo?.({ top: 0 })
  }

  async function save(online = false) {
    if (!online && draft.rows.length === 0) return setConfirmSkip(true)
    const checked = online ? { ok: true as const, times: [] as ClassTimeInput[] } : checkDraft(draft)
    if (!checked.ok) return setError(checked.error)
    setSaving(true)
    const result = await setClassTimes(course.id, checked.times, { quiet: true, online })
    setSaving(false)
    if (!result.ok) return setError(result.error)
    next()
  }

  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-medium text-muted-foreground" aria-live="polite">
          Course {index + 1} of {queue.length}
        </p>
        <h2 className="mt-1 flex flex-wrap items-center gap-x-2 text-lg font-semibold">
          <CourseTag code={course.code} color={course.color} />
          <span>{course.name}</span>
        </h2>
        {course.professor && <p className="text-sm text-muted-foreground">{course.professor}</p>}
      </div>
      <ClassTimesFields key={course.id} id={`class-steps-${course.id}`} value={draft} onChange={setDraft} course={course} />
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="outline" className="sm:mr-auto" onClick={() => void save(true)} disabled={saving}>
          <LaptopIcon data-icon="inline-start" />
          It&apos;s online (no class meetings)
        </Button>
        <Button type="button" variant="ghost" onClick={() => setConfirmSkip(true)} disabled={saving}>
          Skip
        </Button>
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : last ? "Save and finish" : "Save and next"}
        </Button>
      </div>

      <AlertDialog open={confirmSkip} onOpenChange={setConfirmSkip}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skip class times for {course.code}?</AlertDialogTitle>
            <AlertDialogDescription>
              {course.code} won&apos;t be on your calendar, and the Planner may schedule study time while you&apos;re in
              class. You can add class times later in Courses.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Add times</AlertDialogCancel>
            <AlertDialogAction onClick={next}>Skip anyway</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// Courses without class times that the student hasn't been asked about yet
// (none while the page is rendered on the server).
export function useCoursesToAsk(): Course[] {
  const { courses, recurringCommitments } = useAppStore()
  const asked = useAskedCourseIds()
  if (!asked) return []
  const withTimes = new Set(recurringCommitments.map((commitment) => commitment.courseId).filter(Boolean))
  return courses.filter((course) => !course.online && !withTimes.has(course.id) && !asked.has(course.id))
}

// ---- The notice ----------------------------------------------------------------------------------

export function ClassTimesNotice() {
  const toAsk = useCoursesToAsk()
  const [open, setOpen] = useState(false)
  // Kept while the dialog is open (answering removes courses from toAsk).
  const [asking, setAsking] = useState<Course[]>([])
  if (toAsk.length === 0 && !open) return null

  return (
    <>
      {toAsk.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-primary/[0.06] px-4 py-3 text-sm ring-1 ring-primary/15">
          <CalendarClockIcon aria-hidden className="size-5 shrink-0 text-primary" />
          <p className="min-w-0 flex-1">
            <span className="font-medium">
              {toAsk.length === 1
                ? `${toAsk[0].code} isn't on your calendar yet.`
                : `${toAsk.length} courses aren't on your calendar yet.`}
            </span>{" "}
            <span className="text-muted-foreground">Add class times so the Planner keeps class time free.</span>
          </p>
          <Button
            size="sm"
            onClick={() => {
              setAsking(toAsk)
              setOpen(true)
            }}
          >
            Add class times
          </Button>
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Add your class times</DialogTitle>
            <DialogDescription>When each course meets, so it&apos;s on your calendar.</DialogDescription>
          </DialogHeader>
          {open && asking.length > 0 && <ClassTimesSteps courses={asking} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  )
}

function OnlineChoice({ id, checked, onChange }: { id: string; checked: boolean; onChange: (online: boolean) => void }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5">
      <Checkbox id={id} checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <Label htmlFor={id} className="grid gap-0.5 font-normal">
        <span className="font-medium">Online course</span>
        <span className="text-xs text-muted-foreground">No class meetings, so nothing goes on your calendar.</span>
      </Label>
    </div>
  )
}
