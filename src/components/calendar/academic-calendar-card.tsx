"use client"

import { useState } from "react"
import { CalendarDaysIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { academicKindStyle } from "@/components/calendar/academic-style"
import { Field, SimpleSelect } from "@/components/form-fields"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { academicDates, academicKindLabel } from "@/lib/academic-calendar"
import { useAppStore } from "@/lib/app-store"
import { academicEventKinds, type AcademicEvent, type AcademicEventInput, type AcademicEventKind } from "@/lib/types"
import { AcademicCalendarFinder } from "./academic-calendar-finder"
import { cn } from "@/lib/utils"
import { academicEventSchema, firstIssue } from "@/lib/validation"

// Calendar > Academic calendar: the school's semesters, days without classes,
// exam periods and deadlines. Class times follow them: they start and end with the
// semester and don't meet on breaks, holidays or during exams.

const kindOptions = academicEventKinds.map((kind) => ({ value: kind, label: academicKindLabel[kind] }))

export function AcademicCalendarCard() {
  const { academicEvents, student, deleteAcademicEvent } = useAppStore()
  // null = no form; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null)

  // Grouped by semester, in date order; dates without one last.
  const groups = new Map<string, AcademicEvent[]>()
  for (const event of academicEvents) {
    const key = event.term ?? ""
    groups.set(key, [...(groups.get(key) ?? []), event])
  }
  const terms = [...new Set(academicEvents.map((event) => event.term).filter((term): term is string => Boolean(term)))]

  return (
    <Card id="academic-calendar">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Academic calendar</CardTitle>
        <CardDescription>
          {student.schoolName ? `${student.schoolName}'s` : "Your school's"} semesters, breaks and exams. Your class times
          follow them: they start and end with the semester, and don&apos;t meet on days without classes.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {academicEvents.length === 0 && editing !== "new" && (
          <p className="flex items-start gap-2 rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">
            <CalendarDaysIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            No academic calendar yet. Student OS can find it on
            {student.schoolDomain ? ` ${student.schoolDomain}` : " your school's website"}, or you can add dates by hand.
          </p>
        )}
        <AcademicCalendarFinder />

        {[...groups.entries()]
          .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : 0))
          .map(([term, events]) => (
            <section key={term || "other"} aria-label={term || "Other dates"} className="grid gap-2">
              <h3 className="text-sm font-semibold">{term || "Other dates"}</h3>
              <ul className="grid gap-1.5">
                {events.map((event) =>
                  editing === event.id ? (
                    <li key={event.id}>
                      <AcademicEventForm
                        initial={event}
                        terms={terms}
                        submitLabel="Save"
                        onDone={() => setEditing(null)}
                        eventId={event.id}
                      />
                    </li>
                  ) : (
                    <li key={event.id} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-2">
                      <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", academicKindStyle[event.kind])}>
                        {academicKindLabel[event.kind]}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{event.title}</p>
                        <p className="text-xs text-muted-foreground">{academicDates(event)}</p>
                      </div>
                      <Button variant="ghost" size="icon-sm" aria-label={`Edit ${event.title}`} onClick={() => setEditing(event.id)}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${event.title}`} onClick={() => deleteAcademicEvent(event.id)}>
                        <Trash2Icon />
                      </Button>
                    </li>
                  )
                )}
              </ul>
            </section>
          ))}

        {editing === "new" ? (
          <AcademicEventForm terms={terms} submitLabel="Add date" onDone={() => setEditing(null)} />
        ) : (
          <Button variant="outline" className="w-fit" onClick={() => setEditing("new")}>
            <PlusIcon data-icon="inline-start" />
            Add a date
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

const blank: AcademicEventInput = { kind: "no_classes", title: "", startDate: "", endDate: "" }

function AcademicEventForm({
  initial = blank,
  terms,
  submitLabel,
  onDone,
  eventId,
}: {
  initial?: AcademicEventInput
  terms: string[]
  submitLabel: string
  onDone: () => void
  eventId?: string
}) {
  const { addAcademicEvent, updateAcademicEvent } = useAppStore()
  const [value, setValue] = useState<AcademicEventInput>({ ...initial, term: initial.term ?? terms[0] ?? "" })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (changes: Partial<AcademicEventInput>) => setValue((prev) => ({ ...prev, ...changes }))
  const id = eventId ?? "new"

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // A one-day item: the last day is the first day.
    const parsed = academicEventSchema.safeParse({ ...value, endDate: value.endDate || value.startDate })
    if (!parsed.success) return setError(firstIssue(parsed.error))
    setSaving(true)
    const result = eventId ? await updateAcademicEvent(eventId, parsed.data) : await addAcademicEvent(parsed.data)
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onDone()
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4 rounded-lg border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-[11rem_minmax(0,1fr)]">
        <Field label="What is it?" htmlFor={`academic-${id}-kind`}>
          <SimpleSelect
            id={`academic-${id}-kind`}
            value={value.kind}
            options={kindOptions}
            onChange={(kind) => set({ kind: kind as AcademicEventKind })}
          />
        </Field>
        <Field label="Name" htmlFor={`academic-${id}-title`}>
          <Input
            id={`academic-${id}-title`}
            placeholder={value.kind === "term" ? "e.g. Fall 2026" : "e.g. Thanksgiving break"}
            value={value.title}
            onChange={(e) => set({ title: e.target.value })}
            autoFocus
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Field label="First day" htmlFor={`academic-${id}-start`}>
          <Input id={`academic-${id}-start`} type="date" value={value.startDate} onChange={(e) => set({ startDate: e.target.value })} />
        </Field>
        <Field label="Last day" htmlFor={`academic-${id}-end`} optional>
          <Input id={`academic-${id}-end`} type="date" value={value.endDate} onChange={(e) => set({ endDate: e.target.value })} />
        </Field>
        <div className="col-span-2 sm:col-span-1">
          <Field label="Semester" htmlFor={`academic-${id}-term`} optional>
            <Input
              id={`academic-${id}-term`}
              list={`academic-${id}-terms`}
              placeholder="e.g. Fall 2026"
              value={value.term ?? ""}
              onChange={(e) => set({ term: e.target.value })}
            />
          </Field>
          <datalist id={`academic-${id}-terms`}>
            {terms.map((term) => (
              <option key={term} value={term} />
            ))}
          </datalist>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}
