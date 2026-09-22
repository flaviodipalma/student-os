"use client"

import { useState } from "react"
import { Trash2Icon } from "lucide-react"
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
import { Button } from "@/components/ui/button"
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
import { courses } from "@/lib/data/courses"
import { useEvents } from "@/lib/event-store"
import { eventTypeLabel, eventTypes, fromMinutes, toMinutes } from "@/lib/events"
import type { CalendarEvent, EventInput, EventType } from "@/lib/types"

// Where a new event starts out, e.g. from clicking an empty spot on the calendar.
export type EventDraft = { date: string; startTime: string }

const NO_COURSE = "none"
const typeOptions = eventTypes.map((value) => ({ value, label: eventTypeLabel[value] }))
const courseOptions = [
  { value: NO_COURSE, label: "None" },
  ...courses.map((course) => ({ value: course.id, label: `${course.code} · ${course.name}` })),
]

// Create an event (pass `draft`) or edit one (pass `event`).
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>
            {event ? "Update or remove this event." : "Block out time on your calendar."}
          </DialogDescription>
        </DialogHeader>
        <EventForm event={event} draft={draft} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function EventForm({
  event,
  draft,
  onDone,
}: {
  event?: CalendarEvent
  draft?: EventDraft
  onDone: () => void
}) {
  const { addEvent, updateEvent, deleteEvent } = useEvents()
  const defaultStart = draft?.startTime ?? "09:00"
  const [title, setTitle] = useState(event?.title ?? "")
  const [date, setDate] = useState(event?.date ?? draft?.date ?? "")
  const [startTime, setStartTime] = useState(event?.startTime ?? defaultStart)
  const [endTime, setEndTime] = useState(
    event?.endTime ?? fromMinutes(Math.min(toMinutes(defaultStart) + 60, 24 * 60 - 1))
  )
  const [type, setType] = useState<EventType>(event?.type ?? "study")
  const [courseId, setCourseId] = useState(event?.courseId ?? NO_COURSE)
  const [description, setDescription] = useState(event?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return setError("Give the event a title.")
    if (!date) return setError("Pick a date.")
    if (!startTime || !endTime) return setError("Set a start and end time.")
    if (toMinutes(endTime) <= toMinutes(startTime)) return setError("End time must be after the start time.")

    const input: EventInput = {
      title: title.trim(),
      date,
      startTime,
      endTime,
      type,
      description: description.trim() || undefined,
      courseId: courseId === NO_COURSE ? undefined : courseId,
      taskId: event?.taskId,
    }
    if (event) updateEvent(event.id, input)
    else addEvent(input)
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
          autoFocus
        />
      </Field>
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="event-type">
          <SimpleSelect id="event-type" value={type} onChange={(v) => setType(v as EventType)} options={typeOptions} />
        </Field>
        <Field label="Course" htmlFor="event-course" optional>
          <SimpleSelect id="event-course" value={courseId} onChange={setCourseId} options={courseOptions} />
        </Field>
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

      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="sm:justify-between">
        {event ? (
          <Button type="button" variant="destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2Icon data-icon="inline-start" />
            Delete
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit">{event ? "Save changes" : "Add event"}</Button>
        </div>
      </DialogFooter>

      {event && (
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this event?</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{event.title}&rdquo; will be removed from your calendar. This can&apos;t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                onClick={() => {
                  deleteEvent(event.id)
                  setConfirmDelete(false)
                  onDone()
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </form>
  )
}
