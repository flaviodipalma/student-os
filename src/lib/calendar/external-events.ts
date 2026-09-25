import { addDays } from "@/lib/format"
import { wallClockIn } from "@/lib/time-zone"
import type { CalendarEvent, ExternalCalendarSource, ExternalEventRecord } from "@/lib/types"

// External calendar events (Google Calendar, Outlook, ...) in Student OS.
//
//   provider calendar
//     -> provider-specific adapter (server/integrations/calendar/google, /outlook)
//     -> ExternalCalendarEvent       normalized, provider-independent (below)
//     -> calendar sync service       one row per (student, source, externalId)
//     -> ExternalEventRecord         what the app loads
//     -> CalendarEvent items         per day, in the student's time zone (below),
//                                    used by the Calendar, Dashboard and Planner
//
// External events are read-only copies: Student OS never changes the original.
// A student can hide one locally; a sync never un-hides it.

// Normalized event from any provider. Only what the source actually says:
// optional fields are null when the source doesn't have them.
export type ExternalCalendarEvent = {
  source: ExternalCalendarSource
  // Stable id from the provider. Unique per source (Canvas "123" and Blackboard
  // "123" are different events).
  externalId: string
  title: string
  description: string | null
  // Real instants (ISO 8601, UTC). Converted to the student's time zone only for display.
  startsAt: string
  endsAt: string
  location: string | null
  // Already validated by the provider parser (its own LMS host, https).
  url: string | null
}

// Limits: a longer event isn't a schedule block (it would block days of study
// time); it's skipped rather than guessed at.
export const MAX_EVENT_MS = 7 * 24 * 60 * 60 * 1000
const MAX_TITLE = 200
const MAX_DESCRIPTION = 2000
const MAX_LOCATION = 200

export type NormalizeResult = { event: ExternalCalendarEvent } | { skipped: "no-title" | "no-time" | "all-day" | "no-length" | "too-long" }

// Builds a normalized event from a provider's raw fields, or says why it can't.
export function normalizeExternalEvent(raw: {
  source: ExternalCalendarSource
  externalId: string
  title: string | null
  description?: string | null
  start: Date | null
  // One of end / durationMs, as the source gives it.
  end?: Date | null
  durationMs?: number | null
  allDay?: boolean
  location?: string | null
  url?: string | null
}): NormalizeResult {
  const title = raw.title?.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE)
  if (!title || !raw.externalId.trim()) return { skipped: "no-title" }
  // All-day items (holidays, "no class") aren't blocks of time on the schedule.
  if (raw.allDay) return { skipped: "all-day" }
  if (!raw.start || Number.isNaN(raw.start.getTime())) return { skipped: "no-time" }
  const end = raw.end ?? (raw.durationMs != null ? new Date(raw.start.getTime() + raw.durationMs) : null)
  if (!end || Number.isNaN(end.getTime())) return { skipped: "no-time" }
  const length = end.getTime() - raw.start.getTime()
  // A point in time (e.g. a due time) doesn't occupy the schedule.
  if (length <= 0) return { skipped: "no-length" }
  if (length > MAX_EVENT_MS) return { skipped: "too-long" }
  return {
    event: {
      source: raw.source,
      externalId: raw.externalId.trim(),
      title,
      description: raw.description?.trim().slice(0, MAX_DESCRIPTION) || null,
      startsAt: raw.start.toISOString(),
      endsAt: end.toISOString(),
      location: raw.location?.replace(/\s+/g, " ").trim().slice(0, MAX_LOCATION) || null,
      url: raw.url ?? null,
    },
  }
}

// ---- Syncing (pure plan; the service applies it) ----------------------------

export type StoredExternalEvent = ExternalCalendarEvent & { id: string; removedAt: string | null }

export type ExternalEventAction =
  | { kind: "create"; event: ExternalCalendarEvent }
  | { kind: "update"; id: string; event: ExternalCalendarEvent }
  // Gone from the provider: kept, but no longer shown.
  | { kind: "remove"; id: string }

const syncedFields = ["title", "description", "startsAt", "endsAt", "location", "url"] as const

// New -> create; changed -> update (the provider is the source of truth for its
// read-only events); unchanged -> nothing; back after being gone -> update
// (shown again). Missing -> remove, but only events that haven't ended by
// `missingFrom`: feeds cover a limited window, so older events simply age out.
// Hidden events are synced like any other and stay hidden (hiding isn't a field here).
export function planExternalEvents(
  existing: StoredExternalEvent[],
  incoming: ExternalCalendarEvent[],
  options: { source: ExternalCalendarSource; missingFrom: Date }
): ExternalEventAction[] {
  const bySourceId = new Map(existing.filter((e) => e.source === options.source).map((e) => [e.externalId, e]))
  const seen = new Set<string>()
  const actions: ExternalEventAction[] = []
  for (const event of incoming) {
    // Only this source's events; the first of any repeated id wins.
    if (event.source !== options.source || seen.has(event.externalId)) continue
    seen.add(event.externalId)
    const stored = bySourceId.get(event.externalId)
    if (!stored) actions.push({ kind: "create", event })
    else if (stored.removedAt || syncedFields.some((field) => stored[field] !== event[field])) {
      actions.push({ kind: "update", id: stored.id, event })
    }
  }
  for (const stored of bySourceId.values()) {
    if (!seen.has(stored.externalId) && !stored.removedAt && new Date(stored.endsAt) > options.missingFrom) {
      actions.push({ kind: "remove", id: stored.id })
    }
  }
  return actions
}

// ---- Showing (the student's time zone) --------------------------------------

const pad = (n: number) => String(n).padStart(2, "0")

// An instant -> the student's local date key and minutes since midnight.
function localPoint(iso: string, timeZone: string | undefined): { date: string; minutes: number } {
  const [year, month, day, hours, minutes] = wallClockIn(timeZone, new Date(iso))
  return { date: `${year}-${pad(month + 1)}-${pad(day)}`, minutes: hours * 60 + minutes }
}

const time = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`

// Visible external events -> calendar items, one per local day they touch (an
// event crossing midnight shows on both days: until "24:00", then from "00:00").
// The conversion uses the time zone's own rules (DST included); no offsets are
// added or subtracted by hand. Hidden and removed events aren't included.
export function externalEventsAsCalendarItems(records: ExternalEventRecord[], timeZone: string | undefined): CalendarEvent[] {
  const items: CalendarEvent[] = []
  for (const record of records) {
    if (record.hidden) continue
    const start = localPoint(record.startsAt, timeZone)
    const end = localPoint(record.endsAt, timeZone)
    // Real length in minutes: used when the wall clock repeats an hour (the night
    // DST ends), where 1:30 AM -> 1:30 AM is really an hour long.
    const realMinutes = Math.ceil((new Date(record.endsAt).getTime() - new Date(record.startsAt).getTime()) / 60_000)
    for (let date = start.date; date <= end.date; date = addDays(date, 1)) {
      const from = date === start.date ? start.minutes : 0
      let to = date === end.date ? end.minutes : 24 * 60
      if (start.date === end.date && to <= from && realMinutes > 0) to = Math.min(from + realMinutes, 24 * 60)
      if (to <= from) continue
      items.push({
        id: `external:${record.id}:${date}`,
        title: record.title,
        date,
        startTime: time(from),
        endTime: time(to),
        // Not guessed from the source: a Canvas event isn't necessarily a class.
        type: "other",
        ...(record.description ? { description: record.description } : {}),
        source: record.source,
        externalEventId: record.id,
        ...(record.location ? { location: record.location } : {}),
        ...(record.url ? { url: record.url } : {}),
      })
    }
  }
  return items
}
