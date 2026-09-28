"use client"

import { useState } from "react"
import { ExternalLinkIcon, FileUpIcon, LinkIcon, Loader2Icon, SearchIcon, XIcon } from "lucide-react"
import { academicKindStyle } from "@/components/calendar/academic-style"
import { Field } from "@/components/form-fields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { academicDates, academicKindLabel } from "@/lib/academic-calendar"
import { useAppStore } from "@/lib/app-store"
import type { AcademicEventInput, ReadCalendarResponse } from "@/lib/types"
import { cn } from "@/lib/utils"

// Finding the academic calendar: on the school's website (the button), or from a
// link or PDF the student gives. What's found is shown for review (remove anything
// wrong), and only "Save this calendar" puts it in the student's calendar.

type State =
  | { kind: "idle" }
  | { kind: "reading"; what: string }
  | { kind: "review"; events: AcademicEventInput[]; sources: string[]; from: string }
  | { kind: "not-found"; from: string }
  | { kind: "error"; message: string }

export async function readCalendar(fields: Record<string, string | File>, today: string): Promise<ReadCalendarResponse> {
  const form = new FormData()
  form.set("today", today)
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  try {
    const response = await fetch("/api/academic-calendar/read", { method: "POST", body: form })
    return (await response.json()) as ReadCalendarResponse
  } catch {
    return { ok: false, message: "We couldn't reach Student OS. Check your connection and try again." }
  }
}

export function AcademicCalendarFinder({ onSaved }: { onSaved?: () => void }) {
  const { student, today, academicEvents } = useAppStore()
  const [state, setState] = useState<State>({ kind: "idle" })
  const [showOther, setShowOther] = useState(false)
  const [link, setLink] = useState("")
  const site = student.schoolDomain

  async function run(fields: Record<string, string | File>, what: string, from: string) {
    setState({ kind: "reading", what })
    const result = await readCalendar(fields, today)
    if (!result.ok) return setState({ kind: "error", message: result.message })
    if (result.proposal.status === "found") {
      setShowOther(false)
      return setState({ kind: "review", events: result.proposal.events, sources: result.proposal.sources, from })
    }
    setShowOther(true)
    setState({ kind: "not-found", from })
  }

  if (state.kind === "review") {
    return (
      <AcademicCalendarReview
        events={state.events}
        sources={state.sources}
        from={state.from}
        onDone={(saved) => {
          setState({ kind: "idle" })
          if (saved) onSaved?.()
        }}
      />
    )
  }

  const reading = state.kind === "reading"
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {site && (
          <Button
            variant={academicEvents.length === 0 ? "default" : "outline"}
            disabled={reading}
            onClick={() => void run({ mode: "school" }, `Looking on ${site}…`, `on ${site}`)}
          >
            <SearchIcon data-icon="inline-start" />
            {academicEvents.length === 0 ? `Find it on ${site}` : `Update from ${site}`}
          </Button>
        )}
        {!showOther && (
          <Button variant="ghost" disabled={reading} onClick={() => setShowOther(true)}>
            Use a link or PDF
          </Button>
        )}
      </div>

      {reading && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2Icon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
          {state.what} This can take up to a minute.
        </p>
      )}
      {state.kind === "not-found" && (
        <p role="status" className="text-sm text-muted-foreground">
          We couldn&apos;t find the academic calendar {state.from}. Paste a link to it, or upload it as a PDF.
        </p>
      )}
      {state.kind === "error" && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {state.message}
        </p>
      )}

      {showOther && (
        <div className="grid gap-3 rounded-lg border border-dashed p-4">
          <form
            className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end"
            onSubmit={(event) => {
              event.preventDefault()
              if (link.trim()) void run({ mode: "link", url: link.trim() }, "Reading that page…", "at that link")
            }}
          >
            <Field label="Link to your academic calendar" htmlFor="academic-calendar-link">
              <Input
                id="academic-calendar-link"
                type="url"
                inputMode="url"
                placeholder="https://www.school.edu/academic-calendar"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="outline" disabled={reading || !link.trim()}>
              <LinkIcon data-icon="inline-start" />
              Read link
            </Button>
          </form>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">or</span>
            <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-md px-2 font-medium text-primary hover:underline has-[input:focus-visible]:ring-3 has-[input:focus-visible]:ring-ring/50">
              <FileUpIcon aria-hidden className="size-4" />
              Upload the PDF
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="sr-only"
                disabled={reading}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ""
                  if (file) void run({ mode: "pdf", file }, "Reading the PDF…", "in that PDF")
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

// A calendar to check before it's saved: where it was found, its dates by semester
// (remove what doesn't apply), then "Save this calendar". Used by Settings and onboarding.
export function AcademicCalendarReview({
  events: found,
  sources,
  from,
  onDone,
  cancelLabel = "Cancel",
}: {
  events: AcademicEventInput[]
  sources: string[]
  from: string
  onDone: (saved: boolean) => void
  cancelLabel?: string
}) {
  const { academicEvents, replaceAcademicCalendar } = useAppStore()
  const [events, setEvents] = useState(found)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    const result = await replaceAcademicCalendar(events)
    setSaving(false)
    if (!result.ok) return setError(result.error)
    onDone(true)
  }

  const byTerm = new Map<string, AcademicEventInput[]>()
  for (const event of events) byTerm.set(event.term ?? "", [...(byTerm.get(event.term ?? "") ?? []), event])
  return (
    <section aria-label="Review the calendar" className="grid gap-4 rounded-lg border bg-card p-4">
      <div>
        <h3 className="font-semibold">Is this right?</h3>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Found {from}. Check the dates and remove anything that doesn&apos;t apply to you.
        </p>
        {sources.length > 0 && (
          <ul className="mt-1.5 grid gap-0.5 text-xs">
            {sources.map((source) => (
              <li key={source}>
                <a href={source} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-primary hover:underline">
                  <span className="truncate">{source.replace(/^https:\/\//, "")}</span>
                  <ExternalLinkIcon aria-hidden className="size-3 shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
      {[...byTerm.entries()].map(([term, termEvents]) => (
        <div key={term || "other"} className="grid gap-1.5">
          <h4 className="text-sm font-semibold">{term || "Other dates"}</h4>
          <ul className="grid gap-1">
            {termEvents.map((event) => (
              <li key={`${event.kind}|${event.title}|${event.startDate}`} className="flex items-center gap-3 rounded-lg bg-muted/50 px-3 py-1.5">
                <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", academicKindStyle[event.kind])}>
                  {academicKindLabel[event.kind]}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">{academicDates(event)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove ${event.title}`}
                  onClick={() => setEvents((prev) => prev.filter((other) => other !== event))}
                >
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {academicEvents.length > 0 && (
        <p className="text-sm text-muted-foreground">
          Saving replaces the {academicEvents.length} {academicEvents.length === 1 ? "date" : "dates"} in your academic calendar now.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void save()} disabled={saving || events.length === 0}>
          {saving ? "Saving…" : "Save this calendar"}
        </Button>
        <Button variant="ghost" onClick={() => onDone(false)} disabled={saving}>
          {cancelLabel}
        </Button>
      </div>
    </section>
  )
}
