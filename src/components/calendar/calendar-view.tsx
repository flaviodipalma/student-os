"use client"

import { useState } from "react"
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useNow } from "@/lib/clock"
import { useEvents } from "@/lib/event-store"
import { eventTypeLabel, eventTypes } from "@/lib/events"
import { addDays, fromDateKey, toDateKey } from "@/lib/format"
import type { CalendarEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import { EventFormDialog, type EventDraft } from "./event-form-dialog"
import { eventStyle } from "./event-style"
import { TimeGrid } from "./time-grid"

type View = "day" | "week"

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

export function CalendarView() {
  const { scheduleBetween } = useEvents()
  const now = useNow()
  const today = toDateKey(now)
  const [view, setView] = useState<View>("week")
  const [anchor, setAnchor] = useState(today)

  // Dialog state: which event is being edited, or where a new one starts.
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<CalendarEvent | undefined>()
  const [draft, setDraft] = useState<EventDraft | undefined>()

  const days =
    view === "week"
      ? Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i))
      : [anchor]
  // Only the visible days: weekly commitments are expanded for these dates.
  const events = scheduleBetween(days[0], days[days.length - 1])
  const step = view === "week" ? 7 : 1
  const showsToday = days.includes(today)

  function openNew(date: string, startTime: string) {
    setEditing(undefined)
    setDraft({ date, startTime })
    setDialogOpen(true)
  }

  function openEdit(event: CalendarEvent) {
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

        <ul aria-label="Event types" className="order-last flex w-full flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground sm:order-none sm:w-auto">
          {eventTypes.map((type) => (
            <li key={type} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-sm", eventStyle[type].swatch)} />
              {eventTypeLabel[type]}
            </li>
          ))}
        </ul>

        <div role="group" aria-label="View" className="inline-flex rounded-lg bg-muted p-1">
          {(["day", "week"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={view === option}
              onClick={() => setView(option)}
              className={cn(
                "rounded-md px-3 py-1 text-sm font-medium capitalize transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                view === option ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

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
    </div>
  )
}
