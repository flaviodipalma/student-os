"use client"

import { useState } from "react"
import { RepeatIcon, Trash2Icon } from "lucide-react"
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
import { Field, SimpleSelect } from "@/components/form-fields"
import { DayPicker } from "@/components/preferences/commitments-editor"
import { Button } from "@/components/ui/button"
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
import { Textarea } from "@/components/ui/textarea"
import { useCourses } from "@/lib/course-store"
import { fromDateKey } from "@/lib/format"
import { useCommitments, useEvents, useStudySessions } from "@/lib/event-store"
import { eventTypeLabel, eventTypes, fromMinutes, toMinutes } from "@/lib/events"
import type { CalendarEvent, EventInput, EventType, RecurringCommitment, RecurringCommitmentInput } from "@/lib/types"
import { commitmentInputSchema, firstIssue } from "@/lib/validation"

// Where a new event starts out, e.g. from clicking an empty spot on the calendar.
export type EventDraft = { date: string; startTime: string }

const NO_COURSE = "none"
const typeOptions = eventTypes.map((value) => ({ value, label: eventTypeLabel[value] }))

// Create an event (pass `draft`) or edit one (pass `event`).
//
// Three kinds of calendar item open here:
// - one-time events: edited as usual; new ones can be made repeating ("Does this repeat?")
// - repeating events (weekly commitments): the form edits the rule, so every week
//   changes together; there are no per-week copies to get out of sync
// - study sessions (from the Planner): can only be moved or removed
export function EventFormDialog({
  open,
  onOpenChange,
  event,
  draft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  event?: CalendarEvent
  draft?: EventDraft
}) {
  const { getCommitment } = useCommitments()
  const commitment = event?.commitmentId ? getCommitment(event.commitmentId) : undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {commitment ? "Edit repeating event" : event?.sessionId ? "Study session" : event ? "Edit event" : "New event"}
          </DialogTitle>
          <DialogDescription>
            {commitment
              ? "Changes apply to every week of this event."
              : event?.sessionId
                ? "Move this study session or remove it. It belongs to a task, so its title comes from the task."
                : event
                  ? "Update or remove this event."
                  : "Block out time on your calendar."}
          </DialogDescription>
        </DialogHeader>
        {event?.commitmentId && !commitment ? (
          <p className="text-sm text-muted-foreground">This repeating event was removed.</p>
        ) : (
          <EventForm event={event} commitment={commitment} draft={draft} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function EventForm({
  event,
  commitment,
  draft,
  onDone,
}: {
  event?: CalendarEvent
  commitment?: RecurringCommitment
  draft?: EventDraft
  onDone: () => void
}) {
  const { addEvent, updateEvent, deleteEvent } = useEvents()
  const { addCommitment, updateCommitment, deleteCommitment } = useCommitments()
  const { updateStudySession, deleteStudySession } = useStudySessions()
  // Study sessions (from the Planner) can only be moved or removed here.
  const sessionId = event?.sessionId
  const { courses } = useCourses()
  const courseOptions = [
    { value: NO_COURSE, label: "None" },
    ...courses.map((course) => ({ value: course.id, label: `${course.code} · ${course.name}` })),
  ]
  const source = commitment ?? event
  const defaultStart = draft?.startTime ?? "09:00"
  const initialDate = commitment ? (commitment.startDate ?? "") : (event?.date ?? draft?.date ?? "")
  const [title, setTitle] = useState(source?.title ?? "")
  // For a repeating event, `date` is the day it starts (optional).
  const [date, setDate] = useState(initialDate)
  const [startTime, setStartTime] = useState(source?.startTime ?? defaultStart)
  const [endTime, setEndTime] = useState(
    source?.endTime ?? fromMinutes(Math.min(toMinutes(defaultStart) + 60, 24 * 60 - 1))
  )
  const [type, setType] = useState<EventType>(source?.type ?? "study")
  const [courseId, setCourseId] = useState(event?.courseId ?? NO_COURSE)
  const [description, setDescription] = useState(source?.description ?? "")
  // Only new events can be switched to repeating; a repeating event stays one.
  const [repeats, setRepeats] = useState(Boolean(commitment))
  const [days, setDays] = useState<number[]>(
    commitment?.daysOfWeek ?? (initialDate ? [fromDateKey(initialDate).getDay()] : [])
  )
  const [endDate, setEndDate] = useState(commitment?.endDate ?? "")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function saveRepeating() {
    const parsed = commitmentInputSchema.safeParse({
      title,
      daysOfWeek: [...days].sort((a, b) => a - b),
      startTime,
      endTime,
      type,
      description: description.trim() || undefined,
      startDate: date || undefined,
      endDate: endDate || undefined,
    } satisfies RecurringCommitmentInput)
    if (!parsed.success) return setError(firstIssue(parsed.error))
    setSaving(true)
    const result = commitment
      ? await updateCommitment(commitment.id, parsed.data)
      : await addCommitment(parsed.data)
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onDone()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (repeats) return void saveRepeating()
    if (!title.trim()) return setError("Give the event a title.")
    if (!date) return setError("Pick a date.")
    if (!startTime || !endTime) return setError("Set a start and end time.")
    if (toMinutes(endTime) <= toMinutes(startTime)) return setError("End time must be after the start time.")

    if (sessionId) {
      updateStudySession(sessionId, { date, startTime, endTime })
      return onDone()
    }
    const input: EventInput = {
      title: title.trim(),
      date,
      startTime,
      endTime,
      type,
      description: description.trim() || undefined,
      courseId: courseId === NO_COURSE ? undefined : courseId,
    }
    if (event) updateEvent(event.id, input)
    else addEvent(input)
    onDone()
  }

  function toggleRepeats(on: boolean) {
    setRepeats(on)
    setError(null)
    // Start with the weekday of the chosen date.
    if (on && days.length === 0 && date) setDays([fromDateKey(date).getDay()])
  }

  function handleDelete() {
    if (commitment) deleteCommitment(commitment.id)
    else if (sessionId) deleteStudySession(sessionId)
    else if (event) deleteEvent(event.id)
    setConfirmDelete(false)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <Field label="Title" htmlFor="event-title">
        <Input
          id="event-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Team meeting"
          readOnly={Boolean(sessionId)}
          autoFocus={!sessionId}
        />
      </Field>

      {!event && (
        <Label className="w-fit cursor-pointer">
          <Checkbox id="event-repeats" checked={repeats} onCheckedChange={toggleRepeats} />
          Does this repeat?
        </Label>
      )}
      {commitment && (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <RepeatIcon aria-hidden className="size-4" />
          Repeats weekly
        </p>
      )}

      {repeats ? (
        <>
          <DayPicker id="event-days" value={days} onChange={setDays} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Starts on" htmlFor="event-date" optional={Boolean(commitment)}>
              <Input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Ends on" htmlFor="event-end-date" optional>
              <Input id="event-end-date" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Start" htmlFor="event-start">
              <Input id="event-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End" htmlFor="event-end">
              <Input id="event-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
        </>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date" htmlFor="event-date">
            <Input id="event-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Start" htmlFor="event-start">
            <Input id="event-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </Field>
          <Field label="End" htmlFor="event-end">
            <Input id="event-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
          </Field>
        </div>
      )}

      {!sessionId && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type" htmlFor="event-type">
              <SimpleSelect id="event-type" value={type} onChange={(v) => setType(v as EventType)} options={typeOptions} />
            </Field>
            {/* Repeating events aren't linked to a course (put the course code in the title). */}
            {!repeats && (
              <Field label="Course" htmlFor="event-course" optional>
                <SimpleSelect id="event-course" value={courseId} onChange={setCourseId} options={courseOptions} />
              </Field>
            )}
          </div>
          <Field label="Description" htmlFor="event-description" optional>
            <Textarea
              id="event-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Location, notes…"
              rows={2}
            />
          </Field>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="sm:justify-between">
        {event ? (
          <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon data-icon="inline-start" />
            {commitment ? "Delete all weeks" : "Delete"}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : event ? "Save changes" : repeats ? "Add repeating event" : "Add event"}
          </Button>
        </div>
      </DialogFooter>

      {event && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{commitment ? "Delete this repeating event?" : "Delete this event?"}</AlertDialogTitle>
              <AlertDialogDescription>
                {commitment
                  ? `Every week of “${commitment.title}” will be removed from your calendar, and the Planner will stop keeping this time free. This can’t be undone.`
                  : `“${event.title}” will be removed from your calendar. This can’t be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={handleDelete}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </form>
  )
}
