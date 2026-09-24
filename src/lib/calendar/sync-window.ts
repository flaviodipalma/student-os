import { addDays, fromDateKey, toDateKey } from "@/lib/format"

// How much of a personal calendar (Google Calendar, Outlook) Student OS copies:
// the last week (so "today" and recent days look right) and the next 8 weeks
// (the Planner plans 14 days ahead; the Calendar lets students look further).
// Never the whole history. Change it here, not in the UI or the providers.
export const CALENDAR_SYNC_WINDOW = { pastDays: 7, futureDays: 56 }

export function calendarSyncWindow(now: Date, window = CALENDAR_SYNC_WINDOW): { from: Date; to: Date } {
  const today = toDateKey(now)
  // Whole days, with a day's margin either side so time zones never cut an event off.
  return { from: fromDateKey(addDays(today, -window.pastDays - 1)), to: fromDateKey(addDays(today, window.futureDays + 1)) }
}
