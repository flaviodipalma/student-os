"use client"

import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, EyeOffIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/app-store"
import { useNow } from "@/lib/clock"
import { useMediaQuery } from "@/lib/use-media-query"
import { useEvents } from "@/lib/event-store"
import { eventTypeLabel, eventTypes } from "@/lib/events"
import { addDays, fromDateKey, toDateKey } from "@/lib/format"
import { eventSourceNames, lmsProviderIds, type CalendarEvent, type EventSource } from "@/lib/types"
import { cn } from "@/lib/utils"
import { EventFormDialog, type EventDraft } from "./event-form-dialog"
import { ExternalEventDialog, HiddenEventsDialog } from "./external-event-dialog"
import { eventStyle } from "./event-style"
import { TimeGrid } from "./time-grid"

type View = "day" | "week"

// Which sources to show. Study sessions and weekly commitments are Student OS items.
type SourceFilter = "all" | EventSource
const sourceOf = (event: CalendarEvent): EventSource => event.source ?? "student_os"

// Weeks start on Monday.
function startOfWeek(date: string): string {
  return addDays(date, -((fromDateKey(date).getDay() + 6) % 7))
}

function rangeTitle(view: View, days: string[]): string {
  const first = fromDateKey(days[0])
  if (view === "day") {
    return first.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
  }
  const last = fromDateKey(days[days.length - 1])
  const sameMonth = first.getMonth() === last.getMonth()
  const start = first.toLocaleDateString("en-US", { month: "long", day: "numeric" })
  const end = last.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "long", day: "numeric" })
  return `${start} – ${end}, ${last.getFullYear()}`
}

// `initialDate` / `initialExternalId` (from /calendar?date=...&external=..., e.g. an
// event reminder) open that day and, for a Canvas/Blackboard event, its details.
export function CalendarView({ initialDate, initialExternalId }: { initialDate?: string; initialExternalId?: string } = {}) {
  const { scheduleBetween } = useEvents()
  const { externalEvents } = useAppStore()
  const now = useNow()
  const today = toDateKey(now)
  // Phones start on the Day view (a week doesn't fit); the student's own choice wins.
  const small = useMediaQuery("(max-width: 639px)")
  const [chosenView, setView] = useState<View | null>(null)
  const view: View = chosenView ?? (small ? "day" : "week")
  const [anchor, setAnchor] = useState(initialDate ?? today)

  // Dialog state: which event is being edited, or where a new one starts.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | undefined>()
  const [draft, setDraft] = useState<EventDraft | undefined>()
  // External (Canvas / Blackboard) events open read-only details instead of the form.
  const [externalOpen, setExternalOpen] = useState(Boolean(initialExternalId))
  const [externalId, setExternalId] = useState<string | undefined>(initialExternalId)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const [filter, setFilter] = useState<SourceFilter>("all")
  // Filters appear only once there's something to filter (an external calendar is connected).
  // Same order as everywhere else (Canvas, then Blackboard).
  const sources = lmsProviderIds.filter((source) => externalEvents.some((event) => event.source === source))
  const hiddenCount = externalEvents.filter((event) => event.hidden).length

  const days =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
      : [anchor]
  // Only the visible days: weekly commitments are expanded for these dates.
  const all = scheduleBetween(days[0], days[days.length - 1])
  const events = filter === "all" ? all : all.filter((event) => sourceOf(event) === filter)
  const step = view === "week" ? 7 : 1
  const showsToday = days.includes(today)

  function openNew(date: string, startTime: string) {
    setEditing(undefined)
    setDraft({ date, startTime })
    setDialogOpen(true)
  }

  function openEdit(event: CalendarEvent) {
    if (event.externalEventId) {
      setExternalId(event.externalEventId)
      setExternalOpen(true)
      return
    }
    setEditing(event)
    setDraft(undefined)
    setDialogOpen(true)
  }

  // "New event" defaults to the next full hour today, or 9 AM on another day.
  function openNewFromButton() {
    const date = view === "day" ? anchor : showsToday ? today : days[0]
    const hour = date === today ? Math.min(now.getHours() + 1, 23) : 9
    openNew(date, `${String(hour).padStart(2, "0")}:00`)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            {view === "week" ? (showsToday ? "This week" : "Week") : anchor === today ? "Today" : "Day"}
          </p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight md:text-3xl" aria-live="polite">
            {rangeTitle(view, days)}
          </h1>
        </div>
        <Button size="lg" onClick={openNewFromButton}>
          <PlusIcon data-icon="inline-start" />
          New event
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label={`Previous ${view}`}
            onClick={() => setAnchor(addDays(anchor, -step))}
          >
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" onClick={() => setAnchor(today)} disabled={view === "day" ? anchor === today : showsToday}>
            Today
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label={`Next ${view}`}
            onClick={() => setAnchor(addDays(anchor, step))}
          >
            <ChevronRightIcon />
          </Button>
        </div>

        {/* The color key (hidden on phones, where every block says what it is). */}
        <ul aria-label="Event types" className="hidden flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:flex">
          {eventTypes.map((type) => (
            <li key={type} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-sm", eventStyle[type].swatch)} />
              {eventTypeLabel[type]}
            </li>
          ))}
          {sources.length > 0 && (
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-sm", eventStyle.other.swatch)} />
              Canvas / Blackboard
            </li>
          )}
        </ul>

        <div role="group" aria-label="View" className="inline-flex rounded-lg bg-muted p-1">
          {(["day", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "rounded-md px-3 py-1 max-sm:py-2 text-sm font-medium capitalize transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                view === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {(sources.length > 0 || hiddenCount > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Show events from" className="inline-flex flex-wrap rounded-lg bg-muted p-1">
            {(["all", "student_os", ...sources] as SourceFilter[]).map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={filter === option}
                onClick={() => setFilter(option)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:px-2 max-sm:py-2",
                  filter === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option === "all" ? "All" : eventSourceNames[option]}
              </button>
            ))}
          </div>
          {hiddenCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setHiddenOpen(true)}>
              <EyeOffIcon data-icon="inline-start" />
              {hiddenCount} hidden
            </Button>
          )}
        </div>
      )}

      {events.length === 0 && (
        // Nothing in view: say so, and offer to add something (the grid stays clickable too).
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed px-4 py-3">
          <p className="text-sm text-muted-foreground">
            {filter === "all" ? "No events scheduled" : `No ${eventSourceNames[filter]} events`}{" "}
            {view === "week" ? "this week" : "this day"}. Click a time below or add one.
          </p>
          <Button variant="outline" onClick={openNewFromButton}>
            <PlusIcon data-icon="inline-start" />
            Add event
          </Button>
        </div>
      )}

      <TimeGrid
        days={days}
        events={events}
        today={today}
        nowMinutes={now.getHours() * 60 + now.getMinutes()}
        onSelectDay={
          view === "week"
            ? (date) => {
                setAnchor(date)
                setView("day")
              }
            : undefined
        }
        onSelectSlot={openNew}
        onSelectEvent={openEdit}
      />

      <EventFormDialog
        // A new key per opening resets the form for each event or draft.
        key={editing?.id ?? `${draft?.date}-${draft?.startTime}`}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        event={editing}
        draft={draft}
      />
      <ExternalEventDialog eventId={externalId} open={externalOpen} onOpenChange={setExternalOpen} />
      <HiddenEventsDialog open={hiddenOpen} onOpenChange={setHiddenOpen} />
    </div>
  )
}
