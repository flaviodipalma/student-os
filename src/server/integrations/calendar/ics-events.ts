import "server-only"

import { normalizeExternalEvent, type ExternalCalendarEvent } from "@/lib/calendar/external-events"
import type { ExternalCalendarSource } from "@/lib/types"
import type { IcsEvent } from "../lms/ical"

// iCalendar feed events -> normalized external events. Provider parsers choose
// which events are calendar events and what their stable id and link are; the
// rest (times, all-day, length checks) is the same for every feed.
export function icsEventsToExternal(
  events: IcsEvent[],
  source: ExternalCalendarSource,
  identify: (event: IcsEvent) => { externalId: string; url: string | null } | null
): { events: ExternalCalendarEvent[]; skipped: number } {
  const result: ExternalCalendarEvent[] = []
  let skipped = 0
  for (const event of events) {
    const identity = identify(event)
    if (!identity) continue
    const start = event.start
    const normalized = normalizeExternalEvent({
      source,
      externalId: identity.externalId,
      title: event.summary,
      description: event.description,
      allDay: start?.kind === "date",
      start: start?.kind === "instant" ? start.instant : null,
      end: event.end?.kind === "instant" ? event.end.instant : null,
      durationMs: event.durationMs,
      location: event.location,
      url: identity.url,
    })
    if ("event" in normalized) result.push(normalized.event)
    else skipped++
  }
  return { events: result, skipped }
}
