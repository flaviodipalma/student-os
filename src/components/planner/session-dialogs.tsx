"use client"

import { useState } from "react"
import { Field } from "@/components/form-fields"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { toMinutes } from "@/lib/events"
import { formatDuration } from "@/lib/format"
import type { StudySession } from "@/lib/planner"
import { usePlanActions } from "@/lib/planner-store"

// Two small dialogs for a study session: "Partly done" (how long the student
// actually worked, so only the rest is planned again) and "Reschedule" (move it,
// or put a recommendation on the calendar at another time).

const length = (session: StudySession) => toMinutes(session.endTime) - toMinutes(session.startTime)

export function PartlyDoneDialog({
  session,
  taskTitle,
  open,
  onOpenChange,
}: {
  session: StudySession
  taskTitle: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const actions = usePlanActions()
  const planned = length(session)
  const [minutes, setMinutes] = useState(String(Math.round(planned / 2 / 5) * 5 || 5))
  const [error, setError] = useState<string | null>(null)

  function save(event: React.FormEvent) {
    event.preventDefault()
    const value = Number(minutes)
    if (!Number.isInteger(value) || value < 1 || value > planned) {
      return setError(`Enter the minutes you worked, from 1 to ${planned}.`)
    }
    actions.complete(session, value === planned ? undefined : value)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>How long did you work?</DialogTitle>
            <DialogDescription>
              {taskTitle}: {formatDuration(planned)} planned. What&apos;s left goes back into your plan.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Field label="Minutes worked" htmlFor="partly-minutes" error={error ?? undefined}>
              <Input
                id="partly-minutes"
                type="number"
                inputMode="numeric"
                min={1}
                max={planned}
                step={5}
                value={minutes}
                onChange={(e) => setMinutes(e.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function RescheduleDialog({
  session,
  taskTitle,
  minDate,
  open,
  onOpenChange,
}: {
  session: StudySession
  taskTitle: string
  minDate: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const actions = usePlanActions()
  const [date, setDate] = useState(session.date < minDate ? minDate : session.date)
  const [startTime, setStartTime] = useState(session.startTime)
  const [endTime, setEndTime] = useState(session.endTime)
  const [error, setError] = useState<string | null>(null)

  function save(event: React.FormEvent) {
    event.preventDefault()
    if (!date || date < minDate) return setError("Pick today or a later day.")
    if (!/^\d{2}:\d{2}$/.test(startTime) || !/^\d{2}:\d{2}$/.test(endTime) || toMinutes(endTime) <= toMinutes(startTime)) {
      return setError("The session must end after it starts.")
    }
    actions.reschedule(session, { date, startTime, endTime })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={save} noValidate>
          <DialogHeader>
            <DialogTitle>{session.status === "suggested" ? "Schedule at another time" : "Reschedule session"}</DialogTitle>
            <DialogDescription>{taskTitle}. Reminders follow the new time.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-4 sm:grid-cols-3">
            <Field label="Date" htmlFor="reschedule-date">
              <Input id="reschedule-date" type="date" min={minDate} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field label="Start" htmlFor="reschedule-start">
              <Input id="reschedule-start" type="time" step={300} value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field label="End" htmlFor="reschedule-end">
              <Input id="reschedule-end" type="time" step={300} value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          {error && (
            <p role="alert" className="-mt-2 pb-3 text-sm font-medium text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
