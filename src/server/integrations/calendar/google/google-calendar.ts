import { normalizeExternalEvent, type ExternalCalendarEvent } from "@/lib/calendar/external-events"
import { htmlToText } from "../../lms/normalize"
import { getJson, postTokenForm, safeProviderLink } from "../http"
import { CalendarProviderError, type CalendarAccess, type CalendarProvider, type FetchedCalendar } from "../provider"

// Google Calendar (read-only), Google Calendar API v3.
//
// OAuth 2.0 for web server apps with PKCE: the student grants read-only access to
// their calendar list and events, nothing else (no Gmail, Drive, contacts, and no
// write access). Separate from "Continue with Google" (login), which is Supabase's
// own Google app and asks only for identity.
//
// Events: every calendar the student shows in Google Calendar ("selected"), with
// singleEvents=true so recurring events come back as their occurrences.

const NAME = "Google Calendar"
const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
const TOKEN_URL = "https://oauth2.googleapis.com/token"
const REVOKE_URL = "https://oauth2.googleapis.com/revoke"
const API = "https://www.googleapis.com/calendar/v3"
const API_HOSTS = ["www.googleapis.com"]
const TOKEN_HOSTS = ["oauth2.googleapis.com"]
const LINK_HOSTS = ["www.google.com", "calendar.google.com"]

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
]
// Limits, so one sync can't run away: calendars read and pages per calendar.
const MAX_CALENDARS = 15
const MAX_PAGES = 20

type Config = { clientId: string; clientSecret: string; redirectUri: string }

function config(): Config | null {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null
}

function requireConfig(): Config {
  const value = config()
  if (!value) throw new CalendarProviderError("not-configured", NAME)
  return value
}

// ---- API shapes (only the fields used)

type GoogleCalendarListEntry = { id: string; primary?: boolean; selected?: boolean; hidden?: boolean; deleted?: boolean }
type GoogleDateTime = { dateTime?: string; date?: string; timeZone?: string }
export type GoogleEvent = {
  id: string
  iCalUID?: string
  status?: "confirmed" | "tentative" | "cancelled"
  summary?: string
  description?: string
  location?: string
  htmlLink?: string
  start?: GoogleDateTime
  end?: GoogleDateTime
  recurringEventId?: string
  originalStartTime?: GoogleDateTime
  // "transparent" = shown as free: doesn't take time.
  transparency?: "opaque" | "transparent"
  eventType?: string
  attendees?: { self?: boolean; responseStatus?: string }[]
}

// Why an event isn't copied: not happening, not taking the student's time, or
// not a block of time Student OS can show.
export type GoogleSkip = "cancelled" | "declined" | "free" | "not-busy-type"

// One Google event -> a normalized Student OS event (or why not). Times keep
// their offsets (RFC 3339) and become real instants: no time zone is stripped.
export function googleEventToExternal(event: GoogleEvent): { event: ExternalCalendarEvent } | { skipped: string } {
  if (event.status === "cancelled") return { skipped: "cancelled" satisfies GoogleSkip }
  if (event.attendees?.some((a) => a.self && a.responseStatus === "declined")) return { skipped: "declined" satisfies GoogleSkip }
  if (event.transparency === "transparent") return { skipped: "free" satisfies GoogleSkip }
  // Working location and birthdays aren't appointments.
  if (event.eventType === "workingLocation" || event.eventType === "birthday") return { skipped: "not-busy-type" satisfies GoogleSkip }

  // The same event can appear in several of the student's calendars (an
  // invitation): its iCalUID is shared, so it's copied once. An occurrence of a
  // recurring event adds its original start, which never changes when moved.
  const base = event.iCalUID || event.id
  const occurrence = event.recurringEventId ? event.originalStartTime?.dateTime ?? event.originalStartTime?.date : undefined
  const externalId = occurrence ? `${base}@${new Date(occurrence).toISOString()}` : base

  const result = normalizeExternalEvent({
    source: "google",
    externalId,
    title: event.summary ?? null,
    description: event.description ? htmlToText(event.description) : null,
    start: event.start?.dateTime ? new Date(event.start.dateTime) : null,
    end: event.end?.dateTime ? new Date(event.end.dateTime) : null,
    allDay: Boolean(event.start?.date && !event.start.dateTime),
    location: event.location ?? null,
    url: safeProviderLink(event.htmlLink, LINK_HOSTS),
  })
  return result
}

export const googleCalendarProvider: CalendarProvider = {
  id: "google",
  flow: "google-calendar",
  name: NAME,
  isConfigured: () => config() !== null,

  authorizationUrl({ state, codeChallenge }) {
    const { clientId, redirectUri } = requireConfig()
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: GOOGLE_CALENDAR_SCOPES.join(" "),
      // A refresh token, so syncing works later without signing in again.
      access_type: "offline",
      prompt: "consent",
      // Only these calendar permissions: never merged with any other Google grant.
      include_granted_scopes: "false",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    })
    return `${AUTHORIZE_URL}?${params}`
  },

  async exchangeCode({ code, codeVerifier }) {
    const { clientId, clientSecret, redirectUri } = requireConfig()
    const tokens = await postTokenForm(
      TOKEN_URL,
      { grant_type: "authorization_code", code, code_verifier: codeVerifier, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri },
      { allowedHosts: TOKEN_HOSTS, name: NAME }
    )
    // Google lets students untick permissions on the consent screen.
    const granted = new Set((tokens.scopes ?? "").split(" "))
    if (!GOOGLE_CALENDAR_SCOPES.every((scope) => granted.has(scope))) throw new CalendarProviderError("permission", NAME)
    return tokens
  },

  async refreshTokens(refreshToken) {
    const { clientId, clientSecret } = requireConfig()
    return postTokenForm(
      TOKEN_URL,
      { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret },
      { allowedHosts: TOKEN_HOSTS, name: NAME }
    )
  },

  async getAccount(access) {
    // The primary calendar's id is the account's email address.
    const calendars = await listCalendars(access)
    const primary = calendars.find((calendar) => calendar.primary)
    return { externalAccountId: primary?.id ?? null, email: primary?.id.includes("@") ? primary.id : null }
  },

  async listEvents(access, window): Promise<FetchedCalendar> {
    const calendars = (await listCalendars(access)).filter((c) => !c.deleted && !c.hidden && (c.selected || c.primary)).slice(0, MAX_CALENDARS)
    const events: ExternalCalendarEvent[] = []
    let skipped = 0
    for (const calendar of calendars) {
      let pageToken: string | undefined
      for (let page = 0; page < MAX_PAGES; page++) {
        const params = new URLSearchParams({
          singleEvents: "true",
          orderBy: "startTime",
          timeMin: window.from.toISOString(),
          timeMax: window.to.toISOString(),
          maxResults: "250",
          ...(pageToken ? { pageToken } : {}),
        })
        const body = await getJson<{ items?: GoogleEvent[]; nextPageToken?: string }>(
          access,
          `${API}/calendars/${encodeURIComponent(calendar.id)}/events?${params}`,
          { allowedHosts: API_HOSTS, name: NAME }
        )
        for (const item of body.items ?? []) {
          const result = googleEventToExternal(item)
          if ("event" in result) events.push(result.event)
          else if (!["cancelled", "declined", "free", "not-busy-type"].includes(result.skipped)) skipped++
        }
        pageToken = body.nextPageToken
        if (!pageToken) break
      }
    }
    return { events, skipped }
  },

  async revoke({ accessToken, refreshToken }) {
    await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken ?? accessToken }),
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    })
  },
}

async function listCalendars(access: CalendarAccess): Promise<GoogleCalendarListEntry[]> {
  const calendars: GoogleCalendarListEntry[] = []
  let pageToken: string | undefined
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ maxResults: "250", ...(pageToken ? { pageToken } : {}) })
    const body = await getJson<{ items?: GoogleCalendarListEntry[]; nextPageToken?: string }>(access, `${API}/users/me/calendarList?${params}`, {
      allowedHosts: API_HOSTS,
      name: NAME,
    })
    calendars.push(...(body.items ?? []))
    pageToken = body.nextPageToken
    if (!pageToken) break
  }
  return calendars
}
