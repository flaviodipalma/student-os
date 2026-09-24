import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { googleCalendarProvider, googleEventToExternal, GOOGLE_CALENDAR_SCOPES, type GoogleEvent } from "./google/google-calendar"
import { outlookCalendarProvider, outlookEventToExternal, type OutlookEvent } from "./outlook/outlook-calendar"
import { CalendarProviderError, type CalendarAccess } from "./provider"

// The Google Calendar and Outlook adapters against FAKE provider responses
// (shaped like Calendar API v3 and Microsoft Graph v1.0). No real Google or
// Microsoft account or credentials are used.

const WINDOW = { from: new Date("2026-09-15T00:00:00Z"), to: new Date("2026-11-20T00:00:00Z") }

type Call = { url: URL; init: RequestInit | undefined }
let calls: Call[]
function fakeFetch(handler: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  calls = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      calls.push({ url, init })
      return handler(url, init)
    })
  )
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
function access(tokens = ["tok-1", "tok-2"]): CalendarAccess & { refreshes: number } {
  let i = 0
  const state = {
    refreshes: 0,
    getAccessToken: async () => tokens[i],
    refreshAccessToken: async () => {
      state.refreshes++
      i = Math.min(i + 1, tokens.length - 1)
      return tokens[i]
    },
  }
  return state
}

beforeEach(() => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "google-client"
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret"
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/integrations/google-calendar/callback"
  process.env.OUTLOOK_CALENDAR_CLIENT_ID = "ms-client"
  process.env.OUTLOOK_CALENDAR_CLIENT_SECRET = "ms-secret"
  process.env.OUTLOOK_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/integrations/outlook-calendar/callback"
  delete process.env.OUTLOOK_CALENDAR_TENANT
})
afterEach(() => vi.unstubAllGlobals())

describe("Google Calendar: OAuth", () => {
  it("asks for read-only calendar access only, with PKCE, a refresh token and the configured redirect", () => {
    const url = new URL(googleCalendarProvider.authorizationUrl({ state: "st", codeChallenge: "ch" }))
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth")
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "google-client",
      redirect_uri: "http://localhost:3000/api/integrations/google-calendar/callback",
      response_type: "code",
      scope: "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly",
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
    })
    // No write, Gmail, Drive or login scopes; the secret never goes in the URL.
    expect(url.toString()).not.toMatch(/calendar(\.events)?"|auth\/calendar(\s|$)|gmail|drive|openid|google-secret/)
  })

  it("exchanges the code on the server (with the PKCE verifier) and checks what the student granted", async () => {
    fakeFetch(() => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: GOOGLE_CALENDAR_SCOPES.join(" ") }))
    const tokens = await googleCalendarProvider.exchangeCode({ code: "c0de", codeVerifier: "v3rifier" })
    expect(tokens).toMatchObject({ accessToken: "at", refreshToken: "rt" })
    expect(calls[0].url.toString()).toBe("https://oauth2.googleapis.com/token")
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init?.body)))).toMatchObject({
      grant_type: "authorization_code",
      code: "c0de",
      code_verifier: "v3rifier",
      client_secret: "google-secret",
    })
    // The student unticked calendar access on Google's consent screen.
    fakeFetch(() => json({ access_token: "at", scope: GOOGLE_CALENDAR_SCOPES[0] }))
    await expect(googleCalendarProvider.exchangeCode({ code: "c", codeVerifier: "v" })).rejects.toMatchObject({ kind: "permission" })
  })

  it("refresh: a revoked grant asks to reconnect; an outage doesn't", async () => {
    fakeFetch(() => json({ error: "invalid_grant" }, 400))
    await expect(googleCalendarProvider.refreshTokens("rt")).rejects.toMatchObject({ kind: "reconnect" })
    fakeFetch(() => json({}, 503))
    await expect(googleCalendarProvider.refreshTokens("rt")).rejects.toMatchObject({ kind: "unavailable" })
    fakeFetch(() => json({ error: "invalid_client" }, 401))
    await expect(googleCalendarProvider.refreshTokens("rt")).rejects.toMatchObject({ kind: "not-configured" })
  })

  it("not configured on this server: a clear error, no request", () => {
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    expect(googleCalendarProvider.isConfigured()).toBe(false)
    expect(() => googleCalendarProvider.authorizationUrl({ state: "s", codeChallenge: "c" })).toThrow(CalendarProviderError)
  })
})

describe("Google Calendar: events", () => {
  const event = (overrides: Partial<GoogleEvent>): GoogleEvent => ({
    id: "evt1",
    iCalUID: "evt1@google.com",
    status: "confirmed",
    summary: "Dentist",
    start: { dateTime: "2026-09-22T16:00:00-04:00" },
    end: { dateTime: "2026-09-22T17:00:00-04:00" },
    htmlLink: "https://www.google.com/calendar/event?eid=abc",
    ...overrides,
  })

  it("keeps the provider's offset: real instants, nothing stripped", () => {
    const result = googleEventToExternal(event({ description: "<b>Bring</b> insurance card", location: "  Main St  " }))
    expect(result).toEqual({
      event: {
        source: "google",
        externalId: "evt1@google.com",
        title: "Dentist",
        description: "Bring insurance card",
        startsAt: "2026-09-22T20:00:00.000Z",
        endsAt: "2026-09-22T21:00:00.000Z",
        location: "Main St",
        url: "https://www.google.com/calendar/event?eid=abc",
      },
    })
  })

  it("recurring occurrences get their own stable id (original start), not a new Student OS commitment", () => {
    const a = googleEventToExternal(event({ id: "rec_20260921", recurringEventId: "rec", iCalUID: "rec@google.com", originalStartTime: { dateTime: "2026-09-21T10:30:00-04:00" } }))
    const b = googleEventToExternal(event({ id: "rec_20260928", recurringEventId: "rec", iCalUID: "rec@google.com", originalStartTime: { dateTime: "2026-09-28T10:30:00-04:00" } }))
    expect("event" in a && a.event.externalId).toBe("rec@google.com@2026-09-21T14:30:00.000Z")
    expect("event" in b && b.event.externalId).toBe("rec@google.com@2026-09-28T14:30:00.000Z")
  })

  it("skips what doesn't take the student's time; never invents anything", () => {
    expect(googleEventToExternal(event({ status: "cancelled" }))).toEqual({ skipped: "cancelled" })
    expect(googleEventToExternal(event({ attendees: [{ self: true, responseStatus: "declined" }] }))).toEqual({ skipped: "declined" })
    expect(googleEventToExternal(event({ transparency: "transparent" }))).toEqual({ skipped: "free" })
    expect(googleEventToExternal(event({ eventType: "workingLocation" }))).toEqual({ skipped: "not-busy-type" })
    expect(googleEventToExternal(event({ start: { date: "2026-09-22" }, end: { date: "2026-09-23" } }))).toEqual({ skipped: "all-day" })
    expect(googleEventToExternal(event({ summary: undefined }))).toEqual({ skipped: "no-title" })
    // A link somewhere else isn't kept.
    const bad = googleEventToExternal(event({ htmlLink: "https://evil.example/phish" }))
    expect("event" in bad && bad.event.url).toBeNull()
  })

  it("reads the calendars shown in Google, all pages, occurrences expanded", async () => {
    fakeFetch((url) => {
      if (url.pathname === "/calendar/v3/users/me/calendarList") {
        return json({
          items: [
            { id: "alex@gmail.com", primary: true, selected: true },
            { id: "classes@group.calendar.google.com", selected: true },
            { id: "hidden@group.calendar.google.com", selected: false },
          ],
        })
      }
      const calendarId = decodeURIComponent(url.pathname.split("/")[4])
      expect(url.searchParams.get("singleEvents")).toBe("true")
      expect(url.searchParams.get("timeMin")).toBe(WINDOW.from.toISOString())
      if (calendarId === "alex@gmail.com") {
        return url.searchParams.get("pageToken")
          ? json({ items: [event({ id: "e2", iCalUID: "e2@google.com", summary: "Soccer" })] })
          : json({ items: [event({}), event({ id: "all", iCalUID: "all", start: { date: "2026-09-22" }, end: { date: "2026-09-23" } })], nextPageToken: "p2" })
      }
      // The same invitation in a second calendar: same iCalUID.
      return json({ items: [event({ id: "other-copy" })] })
    })
    const fetched = await googleCalendarProvider.listEvents(access(), WINDOW)
    expect(fetched.events.map((e) => e.externalId)).toEqual(["evt1@google.com", "e2@google.com", "evt1@google.com"])
    expect(fetched.skipped).toBe(1)
    expect(calls.every((call) => (call.init?.headers as Record<string, string>).Authorization === "Bearer tok-1")).toBe(true)
    expect(calls.some((call) => call.url.toString().includes("hidden%40group"))).toBe(false)
  })

  it("an expired token is refreshed once and the request retried", async () => {
    fakeFetch((_url, init) =>
      (init?.headers as Record<string, string>).Authorization === "Bearer tok-1" ? json({}, 401) : json({ items: [{ id: "a@gmail.com", primary: true }] })
    )
    const a = access()
    expect(await googleCalendarProvider.getAccount(a)).toEqual({ externalAccountId: "a@gmail.com", email: "a@gmail.com" })
    expect(a.refreshes).toBe(1)
  })

  it("API errors become safe kinds: revoked, permission, rate limit, outage, network", async () => {
    const cases: [Response | Error, string][] = [
      [json({}, 401), "reconnect"],
      [json({ error: { errors: [{ reason: "insufficientPermissions" }] } }, 403), "permission"],
      [json({ error: { errors: [{ reason: "rateLimitExceeded" }] } }, 403), "rate-limited"],
      [json({}, 429), "rate-limited"],
      [json({}, 503), "unavailable"],
      [new TypeError("fetch failed"), "unavailable"],
    ]
    for (const [response, kind] of cases) {
      fakeFetch(() => {
        if (response instanceof Error) throw response
        return response.clone()
      })
      const error = await googleCalendarProvider.getAccount(access(["t", "t"])).catch((e) => e)
      expect(error).toBeInstanceOf(CalendarProviderError)
      expect(error.kind).toBe(kind)
      // Nothing from the provider's response reaches the message.
      expect(error.message).not.toMatch(/insufficientPermissions|rateLimitExceeded|tok/)
    }
  })
})

describe("Outlook: OAuth", () => {
  it("multi-tenant (personal + school/work), Calendars.Read and offline_access only, PKCE", () => {
    const url = new URL(outlookCalendarProvider.authorizationUrl({ state: "st", codeChallenge: "ch" }))
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize")
    expect(url.searchParams.get("scope")).toBe("offline_access https://graph.microsoft.com/Calendars.Read")
    expect(url.searchParams.get("code_challenge_method")).toBe("S256")
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/integrations/outlook-calendar/callback")
    expect(url.toString()).not.toMatch(/ReadWrite|Mail|Files|ms-secret/)
  })

  it("code exchange and refresh on the server; missing calendar permission is caught", async () => {
    fakeFetch(() => json({ access_token: "at", refresh_token: "rt", expires_in: 3600, scope: "https://graph.microsoft.com/Calendars.Read" }))
    expect(await outlookCalendarProvider.exchangeCode({ code: "c", codeVerifier: "v" })).toMatchObject({ accessToken: "at", refreshToken: "rt" })
    expect(calls[0].url.toString()).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token")
    fakeFetch(() => json({ access_token: "at", scope: "User.Read" }))
    await expect(outlookCalendarProvider.exchangeCode({ code: "c", codeVerifier: "v" })).rejects.toMatchObject({ kind: "permission" })
    fakeFetch(() => json({ error: "invalid_grant" }, 400))
    await expect(outlookCalendarProvider.refreshTokens("rt")).rejects.toMatchObject({ kind: "reconnect" })
  })
})

describe("Outlook: events", () => {
  const event = (overrides: Partial<OutlookEvent>): OutlookEvent => ({
    id: "AAMk-1",
    subject: "Team Meeting",
    start: { dateTime: "2026-09-22T18:00:00.0000000", timeZone: "UTC" },
    end: { dateTime: "2026-09-22T19:15:00.0000000", timeZone: "UTC" },
    showAs: "busy",
    webLink: "https://outlook.office365.com/owa/?itemid=AAMk-1",
    location: { displayName: "Room 4" },
    ...overrides,
  })

  it("Graph UTC times (7-digit fractions) become instants", () => {
    expect(outlookEventToExternal(event({}))).toEqual({
      event: {
        source: "outlook",
        externalId: "AAMk-1",
        title: "Team Meeting",
        description: null,
        startsAt: "2026-09-22T18:00:00.000Z",
        endsAt: "2026-09-22T19:15:00.000Z",
        location: "Room 4",
        url: "https://outlook.office365.com/owa/?itemid=AAMk-1",
      },
    })
    // A time without the UTC zone isn't guessed at.
    expect(outlookEventToExternal(event({ start: { dateTime: "2026-09-22T18:00:00", timeZone: "Pacific Standard Time" } }))).toEqual({ skipped: "no-time" })
  })

  it("skips cancelled, declined, free and all-day items", () => {
    expect(outlookEventToExternal(event({ isCancelled: true }))).toEqual({ skipped: "cancelled" })
    expect(outlookEventToExternal(event({ responseStatus: { response: "declined" } }))).toEqual({ skipped: "declined" })
    expect(outlookEventToExternal(event({ showAs: "free" }))).toEqual({ skipped: "free" })
    expect(outlookEventToExternal(event({ isAllDay: true }))).toEqual({ skipped: "all-day" })
  })

  it("calendarView in UTC, following nextLink pages on Graph only", async () => {
    fakeFetch((url, init) => {
      expect((init?.headers as Record<string, string>).Prefer).toContain('outlook.timezone="UTC"')
      if (url.searchParams.get("$skip")) return json({ value: [event({ id: "AAMk-2", subject: "Lab" })] })
      return json({ value: [event({}), event({ id: "AAMk-3", isAllDay: true })], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/calendarView?$skip=250" })
    })
    const fetched = await outlookCalendarProvider.listEvents(access(), WINDOW)
    expect(fetched.events.map((e) => e.title)).toEqual(["Team Meeting", "Lab"])
    expect(fetched.skipped).toBe(1)
    expect(calls[0].url.pathname).toBe("/v1.0/me/calendarView")
    expect(calls[0].url.searchParams.get("startDateTime")).toBe(WINDOW.from.toISOString())

    // A paging link to another host is refused (the token is never sent there).
    fakeFetch(() => json({ value: [], "@odata.nextLink": "https://evil.example/steal" }))
    await expect(outlookCalendarProvider.listEvents(access(), WINDOW)).rejects.toMatchObject({ kind: "failed" })
    expect(calls).toHaveLength(1)
  })
})
