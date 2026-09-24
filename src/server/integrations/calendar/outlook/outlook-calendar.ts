import { normalizeExternalEvent, type ExternalCalendarEvent } from "@/lib/calendar/external-events"
import { getJson, postTokenForm, safeProviderLink } from "../http"
import { CalendarProviderError, type CalendarProvider, type FetchedCalendar } from "../provider"

// Outlook Calendar (read-only), Microsoft Graph v1.0.
//
// Microsoft identity platform OAuth 2.0 (authorization code + PKCE), multi-tenant:
// personal Microsoft accounts and school/work accounts. Permissions: Calendars.Read
// (read the student's calendars) and offline_access (a refresh token). Nothing
// else: no mail, files or contacts, no write access. Separate from "Continue with
// Microsoft" (login), which asks only for identity.
//
// Events: the student's default calendar through calendarView, which returns
// recurring events as their occurrences, with times asked for in UTC.

const NAME = "Outlook"
const GRAPH = "https://graph.microsoft.com/v1.0"
const API_HOSTS = ["graph.microsoft.com"]
const TOKEN_HOSTS = ["login.microsoftonline.com"]
const LINK_HOSTS = ["outlook.office365.com", "outlook.office.com", "outlook.live.com"]

export const OUTLOOK_CALENDAR_SCOPES = ["offline_access", "https://graph.microsoft.com/Calendars.Read"]
const MAX_PAGES = 40

type Config = { clientId: string; clientSecret: string; redirectUri: string; tenant: string }

function config(): Config | null {
  const clientId = process.env.OUTLOOK_CALENDAR_CLIENT_ID
  const clientSecret = process.env.OUTLOOK_CALENDAR_CLIENT_SECRET
  const redirectUri = process.env.OUTLOOK_CALENDAR_REDIRECT_URI
  // "common" = any Microsoft account (personal, school, work).
  const tenant = process.env.OUTLOOK_CALENDAR_TENANT || "common"
  if (!clientId || !clientSecret || !redirectUri || !/^[A-Za-z0-9.-]+$/.test(tenant)) return null
  return { clientId, clientSecret, redirectUri, tenant }
}

function requireConfig(): Config {
  const value = config()
  if (!value) throw new CalendarProviderError("not-configured", NAME)
  return value
}

const endpoint = (tenant: string, path: "authorize" | "token") => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/${path}`

// ---- API shapes (only the fields used)

type GraphDateTime = { dateTime?: string; timeZone?: string }
export type OutlookEvent = {
  id: string
  subject?: string
  bodyPreview?: string
  start?: GraphDateTime
  end?: GraphDateTime
  isAllDay?: boolean
  isCancelled?: boolean
  // free / tentative / busy / oof / workingElsewhere / unknown
  showAs?: string
  responseStatus?: { response?: string }
  location?: { displayName?: string }
  webLink?: string
}

// Graph gives "2026-09-22T14:00:00.0000000" plus a zone; with the UTC preference the zone is "UTC".
function graphInstant(value: GraphDateTime | undefined): Date | null {
  if (!value?.dateTime || value.timeZone !== "UTC") return null
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/.exec(value.dateTime)
  if (!match) return null
  const ms = match[2] ? match[2].slice(0, 4).padEnd(4, "0") : ""
  return new Date(`${match[1]}${ms}Z`)
}

// One Outlook event -> a normalized Student OS event (or why not).
export function outlookEventToExternal(event: OutlookEvent): { event: ExternalCalendarEvent } | { skipped: string } {
  if (event.isCancelled) return { skipped: "cancelled" }
  if (event.responseStatus?.response === "declined") return { skipped: "declined" }
  // Shown as free / working elsewhere: doesn't take the student's time.
  if (event.showAs === "free" || event.showAs === "workingElsewhere") return { skipped: "free" }
  return normalizeExternalEvent({
    source: "outlook",
    // Each occurrence of a recurring event has its own id in calendarView.
    externalId: event.id,
    title: event.subject ?? null,
    description: event.bodyPreview ?? null,
    start: graphInstant(event.start),
    end: graphInstant(event.end),
    allDay: event.isAllDay === true,
    location: event.location?.displayName ?? null,
    url: safeProviderLink(event.webLink, LINK_HOSTS),
  })
}

const SELECT = "id,subject,bodyPreview,start,end,isAllDay,isCancelled,showAs,responseStatus,location,webLink"
const HEADERS = { Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' }

export const outlookCalendarProvider: CalendarProvider = {
  id: "outlook",
  flow: "outlook-calendar",
  name: NAME,
  isConfigured: () => config() !== null,

  authorizationUrl({ state, codeChallenge }) {
    const { clientId, redirectUri, tenant } = requireConfig()
    const params = new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      redirect_uri: redirectUri,
      response_mode: "query",
      scope: OUTLOOK_CALENDAR_SCOPES.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      // Let the student pick which Microsoft account's calendar to connect.
      prompt: "select_account",
    })
    return `${endpoint(tenant, "authorize")}?${params}`
  },

  async exchangeCode({ code, codeVerifier }) {
    const { clientId, clientSecret, redirectUri, tenant } = requireConfig()
    const tokens = await postTokenForm(
      endpoint(tenant, "token"),
      {
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        scope: OUTLOOK_CALENDAR_SCOPES.join(" "),
      },
      { allowedHosts: TOKEN_HOSTS, name: NAME }
    )
    if (!/Calendars\.Read/i.test(tokens.scopes ?? "")) throw new CalendarProviderError("permission", NAME)
    return tokens
  },

  async refreshTokens(refreshToken) {
    const { clientId, clientSecret, tenant } = requireConfig()
    return postTokenForm(
      endpoint(tenant, "token"),
      { grant_type: "refresh_token", refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, scope: OUTLOOK_CALENDAR_SCOPES.join(" ") },
      { allowedHosts: TOKEN_HOSTS, name: NAME }
    )
  },

  async getAccount(access) {
    // Calendars.Read is enough to see whose calendar it is.
    const calendar = await getJson<{ id?: string; owner?: { address?: string } }>(access, `${GRAPH}/me/calendar?$select=id,owner`, {
      allowedHosts: API_HOSTS,
      name: NAME,
    })
    return { externalAccountId: calendar.id ?? null, email: calendar.owner?.address ?? null }
  },

  async listEvents(access, window): Promise<FetchedCalendar> {
    const params = new URLSearchParams({
      startDateTime: window.from.toISOString(),
      endDateTime: window.to.toISOString(),
      $top: "250",
      $select: SELECT,
    })
    let url: string | undefined = `${GRAPH}/me/calendarView?${params}`
    const events: ExternalCalendarEvent[] = []
    let skipped = 0
    for (let page = 0; page < MAX_PAGES && url; page++) {
      const body: { value?: OutlookEvent[]; "@odata.nextLink"?: string } = await getJson(access, url, {
        allowedHosts: API_HOSTS,
        name: NAME,
        headers: HEADERS,
      })
      for (const item of body.value ?? []) {
        const result = outlookEventToExternal(item)
        if ("event" in result) events.push(result.event)
        else if (!["cancelled", "declined", "free"].includes(result.skipped)) skipped++
      }
      // Paging links are only followed on Graph itself (getJson checks the host).
      url = body["@odata.nextLink"]
    }
    return { events, skipped }
  },

  // Microsoft has no endpoint to revoke one app's refresh token: Student OS
  // deletes its copy. Students can remove the app's access at
  // https://account.microsoft.com/privacy/app-access (personal) or myapps.microsoft.com (school/work).
  async revoke() {},
}
