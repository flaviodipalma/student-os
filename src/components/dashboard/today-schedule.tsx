"use client"

import Link from "next/link"
import { eventStyle } from "@/components/calendar/event-style"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNow } from "@/lib/clock"
import { useEvents } from "@/lib/event-store"
import { eventTypeLabel, eventsOn, freeGaps, toMinutes } from "@/lib/events"
import { formatDuration, formatTime, fromDateKey, toDateKey } from "@/lib/format"
import type { CalendarEvent } from "@/lib/types"
import { cn } from "@/lib/utils"

// Today's events from the shared calendar, with the free time between them.
type Item =
  | { kind: "event"; key: string; start: string; end: string; event: CalendarEvent }
  | { kind: "free"; key: string; start: string; end: string }

export function TodaySchedule({ className }: { className?: string }) {
  const { events } = useEvents()
  const now = useNow()
  const today = toDateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  const todays = eventsOn(events, today)
  const items: Item[] = [
    ...todays.map((event) => ({
      kind: "event" as const,
      key: event.id,
      start: event.startTime,
      end: event.endTime,
      event,
    })),
    ...freeGaps(todays).map((gap) => ({ kind: "free" as const, key: `free-${gap.start}`, ...gap })),
  ].sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end))

  const statusOf = (item: Item) => {
    if (toMinutes(item.end) <= nowMinutes) return "past"
    if (toMinutes(item.start) <= nowMinutes) return "now"
    return "later"
  }
  const nextKey = items.find((item) => toMinutes(item.start) > nowMinutes)?.key
  const time = (hhmm: string) => formatTime(fromDateKey(today, hhmm))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Today&apos;s schedule</CardTitle>
        <CardDescription>
          {todays.length === 0
            ? "Nothing on your calendar today."
            : items.every((item) => statusOf(item) === "past")
              ? "That's everything for today."
              : `${todays.length} ${todays.length === 1 ? "event" : "events"} today`}
        </CardDescription>
        <CardAction>
          <Link
            href="/calendar"
            className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Calendar
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {items.map((item) => {
            const status = statusOf(item)
            const isFree = item.kind === "free"
            const minutes = toMinutes(item.end) - toMinutes(item.start)
            return (
              <li
                key={item.key}
                aria-current={status === "now" ? "time" : undefined}
                className={cn("grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3", status === "past" && "opacity-55")}
              >
                <p className="pt-2 text-right text-sm font-medium tabular-nums">{time(item.start)}</p>
                <div
                  className={cn(
                    "rounded-lg border px-3 py-2",
                    isFree
                      ? "border-dashed border-foreground/15"
                      : cn("border-transparent border-l-[3px]", eventStyle[item.event.type].block),
                    status === "now" && "ring-2 ring-primary/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("font-medium leading-snug", isFree && "text-muted-foreground")}>
                      {isFree ? "Free time" : item.event.title}
                    </p>
                    {status === "now" && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        Now
                      </span>
                    )}
                    {item.key === nextKey && (
                      <span className="shrink-0 rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Up next
                      </span>
                    )}
                  </div>
                  <p className={cn("mt-0.5 text-xs", isFree ? "text-muted-foreground" : "opacity-75")}>
                    {[
                      formatDuration(minutes),
                      `until ${time(item.end)}`,
                      !isFree && eventTypeLabel[item.event.type],
                      !isFree && item.event.description,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
