import "server-only"

import type { ExternalCalendarEvent } from "@/lib/calendar/external-events"
import type { CalendarProviderId } from "@/lib/types"
import { AppError } from "../../errors"
import type { OAuthFlowId } from "../lms/oauth-state"

// The contract every personal calendar provider implements (Google Calendar,
// Outlook). Like LmsProvider for Canvas and Blackboard: the provider knows its
// OAuth endpoints and API; everything else (state, encrypted storage, token
// refresh, the calendar sync, Settings) is shared. Providers only READ.
//
//   provider API -> ExternalCalendarEvent (normalized) -> syncExternalCalendar
//   -> external_calendar_events -> Calendar, Dashboard, Planner, reminders

export type CalendarTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: Date | null
  // What the student actually granted (space-separated).
  scopes: string | null
}

export type CalendarAccount = { externalAccountId: string | null; email: string | null }

// Valid access tokens for one student's connection, for one request. Only the
// token service creates these; providers never see refresh tokens.
export type CalendarAccess = {
  getAccessToken(): Promise<string>
  // After a 401: a new access token (or a CalendarProviderError asking to reconnect).
  refreshAccessToken(): Promise<string>
}

export type FetchedCalendar = {
  events: ExternalCalendarEvent[]
  // Events that can't be shown as a block of time (all-day, no time, too long).
  skipped: number
}

export interface CalendarProvider {
  id: CalendarProviderId
  // The OAuth flow (and callback folder): /api/integrations/<flow>/callback.
  flow: OAuthFlowId
  name: string
  // The server has this provider's OAuth app settings.
  isConfigured(): boolean
  authorizationUrl(input: { state: string; codeChallenge: string }): string
  exchangeCode(input: { code: string; codeVerifier: string }): Promise<CalendarTokens>
  refreshTokens(refreshToken: string): Promise<CalendarTokens>
  getAccount(access: CalendarAccess): Promise<CalendarAccount>
  // Events between `from` and `to`, recurring ones as their occurrences.
  listEvents(access: CalendarAccess, window: { from: Date; to: Date }): Promise<FetchedCalendar>
  // Best effort, on disconnect.
  revoke(tokens: { accessToken: string; refreshToken: string | null }): Promise<void>
}

// Something the student should hear about, with a safe message (never the
// provider's own error text, which can contain tokens or URLs).
export type CalendarErrorKind = "reconnect" | "permission" | "rate-limited" | "unavailable" | "not-configured" | "failed"

export class CalendarProviderError extends AppError {
  constructor(
    readonly kind: CalendarErrorKind,
    name: string
  ) {
    super("validation", calendarErrorMessage(kind, name))
    this.name = "CalendarProviderError"
  }
}

export function calendarErrorMessage(kind: CalendarErrorKind, name: string): string {
  switch (kind) {
    case "reconnect":
      return `Your ${name} connection expired or was removed. Please connect ${name} again.`
    case "permission":
      return `Student OS doesn't have permission to read your ${name} events. Please connect again and allow calendar access.`
    case "rate-limited":
      return `${name} is receiving too many requests right now. Please try again in a few minutes.`
    case "unavailable":
      return `${name} didn't respond. Please try again in a moment.`
    case "not-configured":
      return `${name} isn't set up on this server yet.`
    case "failed":
      return `We couldn't sync ${name}. Please try again.`
  }
}
