"use client"

import { useState } from "react"
import { PencilIcon, PlusIcon, RepeatIcon, Trash2Icon } from "lucide-react"
import { eventStyle } from "@/components/calendar/event-style"
import { Field, SimpleSelect } from "@/components/form-fields"
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
import { Input } from "@/components/ui/input"
import { eventTypeLabel, eventTypes } from "@/lib/events"
import { formatTime, fromDateKey } from "@/lib/format"
import { formatDateRange, formatDays, weekdayLabels } from "@/lib/recurring"
import type { NativeEventType, RecurringCommitmentInput } from "@/lib/types"
import { cn } from "@/lib/utils"
import { commitmentInputSchema, firstIssue } from "@/lib/validation"

// Weekly commitments: a list with edit/delete, plus an add form. Used by
// onboarding (saved together at the end of the step) and Settings (saved one by
// one, with optional start/end dates). The Calendar edits the same records.

export type EditableCommitment = RecurringCommitmentInput & { id: string }

// Returns an error message to show, or null when saved.
type SaveResult = string | null | Promise<string | null>

const typeOptions = eventTypes.map((type) => ({ value: type, label: eventTypeLabel[type] }))
// Monday first.
const dayOrder = [1, 2, 3, 4, 5, 6, 0]
const time = (hhmm: string) => formatTime(fromDateKey("2000-01-01", hhmm))

const blank: RecurringCommitmentInput = { title: "", daysOfWeek: [], startTime: "16:00", endTime: "17:00", type: "sports" }

export function CommitmentsEditor({
  commitments,
  onAdd,
  onUpdate,
  onDelete,
  withDates = false,
  confirmDelete = false,
}: {
  commitments: EditableCommitment[]
  onAdd: (input: RecurringCommitmentInput) => SaveResult
  onUpdate: (id: string, input: RecurringCommitmentInput) => SaveResult
  onDelete: (id: string) => void
  // Show the optional "Starts on" / "Ends on" fields.
  withDates?: boolean
  // Ask before deleting (saved commitments: it removes every week at once).
  confirmDelete?: boolean
}) {
  // null = no form open; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<EditableCommitment | null>(null)

  return (
    <div className="grid gap-3">
      {commitments.length === 0 && editing !== "new" && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          No recurring commitments yet. Add things like practice, work shifts or club meetings, and the Planner will keep
          those times free.
        </p>
      )}
      <ul className="grid gap-2">
        {commitments.map((commitment) =>
          editing === commitment.id ? (
            <li key={commitment.id}>
              <CommitmentForm
                initial={commitment}
                withDates={withDates}
                submitLabel="Save"
                onCancel={() => setEditing(null)}
                onSubmit={async (input) => {
                  const error = await onUpdate(commitment.id, input)
                  if (!error) setEditing(null)
                  return error
                }}
              />
            </li>
          ) : (
            <li
              key={commitment.id}
              className={cn("flex items-center gap-3 rounded-lg border-l-[3px] px-3 py-2", eventStyle[commitment.type].block)}
            >
              <RepeatIcon aria-hidden className="size-4 shrink-0 opacity-60" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{commitment.title}</p>
                <p className="text-xs opacity-80">
                  {[
                    formatDays(commitment.daysOfWeek),
                    `${time(commitment.startTime)} – ${time(commitment.endTime)}`,
                    eventTypeLabel[commitment.type],
                    formatDateRange(commitment),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Edit ${commitment.title}`}
                onClick={() => setEditing(commitment.id)}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Delete ${commitment.title}`}
                onClick={() => (confirmDelete ? setDeleting(commitment) : onDelete(commitment.id))}
              >
                <Trash2Icon />
              </Button>
            </li>
          )
        )}
      </ul>

      {editing === "new" ? (
        <CommitmentForm
          initial={blank}
          withDates={withDates}
          submitLabel="Add commitment"
          onCancel={() => setEditing(null)}
          onSubmit={async (input) => {
            const error = await onAdd(input)
            if (!error) setEditing(null)
            return error
          }}
        />
      ) : (
        <Button variant="outline" className="w-fit" onClick={() => setEditing("new")}>
          <PlusIcon data-icon="inline-start" />
          Add recurring commitment
        </Button>
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this recurring commitment?</AlertDialogTitle>
            <AlertDialogDescription>
              Every week of &ldquo;{deleting?.title}&rdquo; will be removed from your calendar, and the Planner will
              stop keeping this time free. This can&apos;t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CommitmentForm({
  initial,
  withDates,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: RecurringCommitmentInput
  withDates: boolean
  submitLabel: string
  onSubmit: (input: RecurringCommitmentInput) => Promise<string | null>
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (changes: Partial<RecurringCommitmentInput>) => setValue((prev) => ({ ...prev, ...changes }))

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const parsed = commitmentInputSchema.safeParse(value)
    if (!parsed.success) return setError(firstIssue(parsed.error))
    setSaving(true)
    const problem = await onSubmit({ ...parsed.data, daysOfWeek: [...parsed.data.daysOfWeek].sort((a, b) => a - b) })
    setSaving(false)
    setError(problem)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field label="What is it?" htmlFor="commitment-title">
          <Input
            id="commitment-title"
            placeholder="e.g. Soccer practice"
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
            autoFocus
          />
        </Field>
        <Field label="Type" htmlFor="commitment-type">
          <SimpleSelect
            id="commitment-type"
            value={value.type}
            options={typeOptions}
            onChange={(type) => set({ type: type as NativeEventType })}
          />
        </Field>
      </div>
      <DayPicker id="commitment-days" value={value.daysOfWeek} onChange={(daysOfWeek) => set({ daysOfWeek })} />
      <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
        <Field label="Starts" htmlFor="commitment-start">
          <Input id="commitment-start" type="time" value={value.startTime} onChange={(e) => set({ startTime: e.target.value })} />
        </Field>
        <Field label="Ends" htmlFor="commitment-end">
          <Input id="commitment-end" type="time" value={value.endTime} onChange={(e) => set({ endTime: e.target.value })} />
        </Field>
      </div>
      {withDates && (
        <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
          <Field label="Starts on" htmlFor="commitment-start-date" optional>
            <Input
              id="commitment-start-date"
              type="date"
              value={value.startDate ?? ""}
              onChange={(e) => set({ startDate: e.target.value || undefined })}
            />
          </Field>
          <Field label="Ends on" htmlFor="commitment-end-date" optional>
            <Input
              id="commitment-end-date"
              type="date"
              value={value.endDate ?? ""}
              onChange={(e) => set({ endDate: e.target.value || undefined })}
            />
          </Field>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

// Weekday toggle buttons, Monday first. Also used by the Calendar's event form.
export function DayPicker({
  id,
  value,
  onChange,
}: {
  id: string
  value: number[]
  onChange: (daysOfWeek: number[]) => void
}) {
  const toggle = (day: number) => onChange(value.includes(day) ? value.filter((d) => d !== day) : [...value, day])
  return (
    <div className="grid gap-1.5">
      <span id={`${id}-label`} className="text-sm font-medium">
        Days
      </span>
      <div role="group" aria-labelledby={`${id}-label`} className="flex flex-wrap gap-1.5">
        {dayOrder.map((day) => {
          const on = value.includes(day)
          return (
            <button
              key={day}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(day)}
              className={cn(
                "h-8 w-11 rounded-md text-sm font-medium ring-1 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                on ? "bg-primary text-primary-foreground ring-primary" : "bg-background ring-foreground/15 hover:bg-muted"
              )}
            >
              {weekdayLabels[day]}
            </button>
          )
        })}
      </div>
    </div>
  )
}
