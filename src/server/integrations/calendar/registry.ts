import "server-only"

import type { CalendarProviderId } from "@/lib/types"
import { googleCalendarProvider } from "./google/google-calendar"
import { outlookCalendarProvider } from "./outlook/outlook-calendar"
import type { CalendarProvider } from "./provider"

// The personal calendar adapters. A new provider: add its id to
// calendarProviderIds (src/lib/types.ts) and the calendar_provider enum, write a
// CalendarProvider, register it here, and add its callback route.
const providers: Record<CalendarProviderId, CalendarProvider> = {
  google: googleCalendarProvider,
  outlook: outlookCalendarProvider,
}

export function getCalendarProvider(id: CalendarProviderId): CalendarProvider {
  return providers[id]
}
