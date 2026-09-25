import { randomBytes } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { eq } from "drizzle-orm"
import type { Database } from "@/server/db/types"
import { createTestDb } from "@/server/test-utils/test-db"

// Connecting Google Calendar / Outlook from Integrations: the server actions and the
// OAuth callback, with the signed-in student from a (mocked) verified session,
// a real database, and FAKE Google / Microsoft endpoints. Login is never involved.

const KEY = randomBytes(32).toString("base64")
// A fixed event tomorrow (the fake returns the same event on every sync).
const START = new Date(Date.now() + 86_400_000).toISOString()
const END = new Date(Date.now() + 90_000_000).toISOString()
const mocks = vi.hoisted(() => ({
  user: null as { id: string; email: string | null } | null,
  db: null as unknown,
  cookieSet: vi.fn(),
}))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => mocks.user }))
vi.mock("@/server/db", () => ({ getDb: () => mocks.db }))
vi.mock("next/headers", () => ({ cookies: async () => ({ set: mocks.cookieSet }) }))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
}))

const actions = await import("./calendar-integrations")
const { GET: googleCallback } = await import("@/app/api/integrations/google-calendar/callback/route")
const { GET: outlookCallback } = await import("@/app/api/integrations/outlook-calendar/callback/route")
const { createOAuthState, oauthStateCookieName } = await import("@/server/integrations/lms/oauth-state")
const { getCredentialVault } = await import("@/server/integrations/lms/credential-vault")
const { calendarConnections, externalCalendarEvents } = await import("@/server/db/schema")
const { listExternalEvents } = await import("@/server/services/external-events")

let t: Awaited<ReturnType<typeof createTestDb>>
let alex: string
let bob: string
beforeAll(async () => {
  process.env.LMS_TOKEN_ENCRYPTION_KEY = KEY
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "google-client"
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret"
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/integrations/google-calendar/callback"
  process.env.OUTLOOK_CALENDAR_CLIENT_ID = "ms-client"
  process.env.OUTLOOK_CALENDAR_CLIENT_SECRET = "ms-secret"
  process.env.OUTLOOK_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/integrations/outlook-calendar/callback"
  t = await createTestDb()
  mocks.db = t.db as Database
  alex = await t.addUser("Alex")
  bob = await t.addUser("Bob")
})
afterAll(() => t.close())
beforeEach(async () => {
  mocks.user = { id: alex, email: "alex@example.com" }
  mocks.cookieSet.mockClear()
  await t.db.delete(calendarConnections)
  await t.db.delete(externalCalendarEvents)
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL) => {
      const url = new URL(String(input))
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url.host === "oauth2.googleapis.com") {
        return reply({
          access_token: "g-at",
          refresh_token: "g-rt",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar.calendarlist.readonly https://www.googleapis.com/auth/calendar.events.readonly",
        })
      }
      if (url.host === "login.microsoftonline.com") return reply({ access_token: "m-at", refresh_token: "m-rt", expires_in: 3600, scope: "https://graph.microsoft.com/Calendars.Read" })
      if (url.pathname.endsWith("/calendarList")) return reply({ items: [{ id: "alex@gmail.com", primary: true, selected: true }] })
      if (url.host === "www.googleapis.com") {
        return reply({ items: [{ id: "d", iCalUID: "d@google.com", summary: "Dentist", start: { dateTime: START }, end: { dateTime: END } }] })
      }
      if (url.pathname === "/v1.0/me/calendar") return reply({ id: "cal-1", owner: { address: "alex@school.edu" } })
      if (url.host === "graph.microsoft.com") return reply({ value: [] })
      return reply({}, 404)
    })
  )
})
afterEach(() => vi.unstubAllGlobals())

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const redirectOf = (promise: Promise<unknown>) => promise.then(() => null, (error: Error) => error.message.replace(/^REDIRECT /, ""))
const location = (response: Response) => {
  const url = new URL(response.headers.get("location")!)
  return url.pathname + url.search + url.hash
}

// What the browser would have after clicking Connect: the state cookie.
function callbackRequest(flow: "google-calendar" | "outlook-calendar", query: (state: string) => string, userId = alex) {
  const { state, cookieValue } = createOAuthState({ provider: flow, userId, baseUrl: "" }, getCredentialVault())
  return new NextRequest(`http://localhost:3000/api/integrations/${flow}/callback${query(state)}`, {
    headers: { cookie: `${oauthStateCookieName(flow)}=${cookieValue}` },
  })
}

describe("Connect", () => {
  it("Google: a single-use state cookie on the callback path, then Google's consent page", async () => {
    const to = await redirectOf(actions.connectCalendarAction({ error: null }, form({ provider: "google" })))
    expect(to).toMatch(/^https:\/\/accounts\.google\.com\/o\/oauth2\/v2\/auth\?/)
    const [name, , options] = mocks.cookieSet.mock.calls[0]
    expect(name).toBe("lms_oauth_google-calendar")
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/integrations/google-calendar", maxAge: 600 })
  })

  it("Outlook goes to Microsoft; signed out goes to log in; unconfigured explains itself", async () => {
    expect(await redirectOf(actions.connectCalendarAction({ error: null }, form({ provider: "outlook" })))).toMatch(
      /^https:\/\/login\.microsoftonline\.com\/common\/oauth2\/v2\.0\/authorize\?/
    )
    mocks.user = null
    expect(await redirectOf(actions.connectCalendarAction({ error: null }, form({ provider: "google" })))).toBe("/login?next=/integrations")
    mocks.user = { id: alex, email: null }
    const secret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    delete process.env.GOOGLE_CALENDAR_CLIENT_SECRET
    expect(await actions.connectCalendarAction({ error: null }, form({ provider: "google" }))).toEqual({ error: "Google Calendar isn't set up on this server yet." })
    process.env.GOOGLE_CALENDAR_CLIENT_SECRET = secret
    expect(await actions.connectCalendarAction({ error: null }, form({ provider: "icloud" }))).toEqual({ error: "Choose a calendar to connect." })
  })
})

describe("the OAuth callback", () => {
  it("Google: exchanges the code, stores tokens encrypted, runs a first sync, back to Integrations", async () => {
    const response = await googleCallback(callbackRequest("google-calendar", (state) => `?code=abc&state=${state}`))
    expect(location(response)).toBe("/integrations?google-calendar=connected")
    const [row] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))
    expect(row).toMatchObject({ provider: "google", accountEmail: "alex@gmail.com", status: "connected" })
    expect(row.accessTokenEncrypted).not.toContain("g-at")
    expect(row.lastSyncedAt).not.toBeNull()
    expect((await listExternalEvents(t.db, alex)).map((e) => [e.source, e.title])).toEqual([["google", "Dentist"]])
    // Nothing sensitive in the redirect, and the state cookie is cleared.
    expect(response.headers.get("location")).not.toMatch(/g-at|g-rt|code/)
    expect(response.headers.get("set-cookie")).toMatch(/lms_oauth_google-calendar=;/)
  })

  it("Outlook connects the same way, independent of how the student logged in", async () => {
    const response = await outlookCallback(callbackRequest("outlook-calendar", (state) => `?code=abc&state=${state}`))
    expect(location(response)).toBe("/integrations?outlook-calendar=connected")
    const [row] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))
    expect(row).toMatchObject({ provider: "outlook", accountEmail: "alex@school.edu" })
  })

  it("refuses a missing, forged or other student's state (CSRF), a cancel, and signed-out visits", async () => {
    const forged = new NextRequest("http://localhost:3000/api/integrations/google-calendar/callback?code=abc&state=forged", {
      headers: { cookie: `${oauthStateCookieName("google-calendar")}=nope` },
    })
    expect(location(await googleCallback(forged))).toBe("/integrations?google-calendar=invalid_state")
    // A state started by Bob, used in Alex's session.
    expect(location(await googleCallback(callbackRequest("google-calendar", (state) => `?code=abc&state=${state}`, bob)))).toBe(
      "/integrations?google-calendar=invalid_state"
    )
    // Outlook's cookie can't be used for Google.
    const { state, cookieValue } = createOAuthState({ provider: "outlook-calendar", userId: alex, baseUrl: "" }, getCredentialVault())
    const crossed = new NextRequest(`http://localhost:3000/api/integrations/google-calendar/callback?code=abc&state=${state}`, {
      headers: { cookie: `${oauthStateCookieName("google-calendar")}=${cookieValue}` },
    })
    expect(location(await googleCallback(crossed))).toBe("/integrations?google-calendar=invalid_state")
    expect(location(await googleCallback(callbackRequest("google-calendar", () => "?error=access_denied")))).toBe("/integrations?google-calendar=denied")
    mocks.user = null
    expect(location(await googleCallback(callbackRequest("google-calendar", (s) => `?code=abc&state=${s}`)))).toBe("/login")
    expect(await t.db.select().from(calendarConnections)).toEqual([])
  })

  it("the student unticked calendar access at Google: nothing saved, a clear message code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ access_token: "g-at", scope: "openid" }), { status: 200 })))
    expect(location(await googleCallback(callbackRequest("google-calendar", (s) => `?code=abc&state=${s}`)))).toBe(
      "/integrations?google-calendar=permission"
    )
    expect(await t.db.select().from(calendarConnections)).toEqual([])
  })
})

describe("Sync now and Disconnect", () => {
  it("sync returns a summary and the student's events (never tokens); disconnect removes only that calendar", async () => {
    await googleCallback(callbackRequest("google-calendar", (s) => `?code=abc&state=${s}`))
    await t.db.insert(externalCalendarEvents).values({
      userId: alex,
      source: "canvas",
      externalId: "calendar-event-1",
      title: "CSC215",
      startsAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 7_200_000),
    })
    const synced = await actions.syncCalendarAction("google")
    expect(synced.ok && synced.data.result).toMatchObject({ added: 0, updated: 0 })
    expect(JSON.stringify(synced)).not.toMatch(/g-at|g-rt|Encrypted/)

    const gone = await actions.disconnectCalendarAction("google")
    expect(gone.ok && gone.data.externalEvents.map((e) => e.source)).toEqual(["canvas"])
    expect(await t.db.select().from(calendarConnections)).toEqual([])
    // Google was asked to revoke the token.
    expect(vi.mocked(fetch).mock.calls.some(([input]) => String(input) === "https://oauth2.googleapis.com/revoke")).toBe(true)
  })

  it("only the signed-in student's own connection: Bob can't sync or disconnect Alex's", async () => {
    await googleCallback(callbackRequest("google-calendar", (s) => `?code=abc&state=${s}`))
    mocks.user = { id: bob, email: null }
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await actions.syncCalendarAction("google")).toMatchObject({ ok: false })
    expect(await actions.disconnectCalendarAction("google")).toMatchObject({ ok: false })
    expect(await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))).toHaveLength(1)
    mocks.user = null
    expect(await actions.syncCalendarAction("google")).toMatchObject({ ok: false, code: "unauthorized" })
    expect(await actions.syncCalendarAction("drop table")).toMatchObject({ ok: false })
  })
})
