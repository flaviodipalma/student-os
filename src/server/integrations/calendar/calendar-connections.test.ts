import { randomBytes } from "node:crypto"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { eq } from "drizzle-orm"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { toDateKey } from "@/lib/format"
import { generateNotifications } from "@/lib/notifications/generate"
import { createPlanner, dayAvailability, whatNow } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/preferences"
import { scheduleBetween } from "@/lib/recurring"
import { dateFromWallClock, wallClockIn } from "@/lib/time-zone"
import { calendarConnections, externalCalendarEvents } from "../../db/schema"
import { loadAppData } from "../../services/app-data"
import { createCourse } from "../../services/courses"
import { createEvent } from "../../services/events"
import { deleteExternalEventsFrom, listExternalEvents } from "../../services/external-events"
import { createTask } from "../../services/tasks"
import { createTestDb } from "../../test-utils/test-db"
import { createCredentialVault } from "../lms/credential-vault"
import { syncExternalCalendar } from "./calendar-sync"
import { deleteCalendarConnection, getCalendarIntegrationStatus, loadCalendarCredentials, saveCalendarConnection } from "./connections"
import { googleCalendarProvider } from "./google/google-calendar"
import { outlookCalendarProvider } from "./outlook/outlook-calendar"
import { syncCalendarConnection } from "./sync-connection"

// Google Calendar and Outlook through the real connection storage, token
// refresh and calendar sync, on a real Postgres (PGlite), with the app's own
// Planner, "What should I do now?" and reminders on top. The provider APIs are
// FAKES shaped like Calendar API v3 and Microsoft Graph: no real accounts.
//
// Fixed time: Tuesday 2026-09-22, 3:00 PM in New York (19:00 UTC).

const vault = createCredentialVault(randomBytes(32))
const NY = "America/New_York"
const NOW = new Date("2026-09-22T19:00:00Z")
const tokens = (access: string, expiresInMs = 3_600_000) => ({
  accessToken: access,
  refreshToken: `refresh-for-${access}`,
  expiresAt: new Date(NOW.getTime() + expiresInMs),
  scopes: null,
})

// ---- Fake Google and Microsoft

type GEvent = { id: string; summary: string; start: string; end: string; recurringEventId?: string; original?: string; status?: string }
const google = { events: [] as GEvent[], status: 200, refreshStatus: 200, accessCalls: [] as string[] }
const outlook = { events: [] as { id: string; subject: string; start: string; end: string }[], status: 200 }

function fakeProviders() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? ""
      const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
      if (url.host === "oauth2.googleapis.com" && url.pathname === "/token") {
        if (google.refreshStatus !== 200) return reply({ error: "invalid_grant" }, google.refreshStatus)
        return reply({ access_token: "google-access-2", expires_in: 3600 })
      }
      if (url.host === "www.googleapis.com") {
        google.accessCalls.push(auth)
        if (auth === "Bearer google-expired") return reply({}, 401)
        if (google.status !== 200) return reply({}, google.status)
        if (url.pathname.endsWith("/calendarList")) return reply({ items: [{ id: "alex@gmail.com", primary: true, selected: true }] })
        const page = url.searchParams.get("pageToken")
        const items = google.events.map((e) => ({
          id: e.id,
          iCalUID: `${e.recurringEventId ?? e.id}@google.com`,
          status: e.status ?? "confirmed",
          summary: e.summary,
          start: { dateTime: e.start },
          end: { dateTime: e.end },
          recurringEventId: e.recurringEventId,
          originalStartTime: e.original ? { dateTime: e.original } : undefined,
          htmlLink: `https://www.google.com/calendar/event?eid=${e.id}`,
        }))
        // Two pages, to exercise pagination.
        return page ? reply({ items: items.slice(2) }) : reply({ items: items.slice(0, 2), ...(items.length > 2 ? { nextPageToken: "p2" } : {}) })
      }
      if (url.host === "graph.microsoft.com") {
        if (outlook.status !== 200) return reply({}, outlook.status)
        return reply({
          value: outlook.events.map((e) => ({
            id: e.id,
            subject: e.subject,
            start: { dateTime: `${e.start}.0000000`, timeZone: "UTC" },
            end: { dateTime: `${e.end}.0000000`, timeZone: "UTC" },
            showAs: "busy",
            webLink: `https://outlook.office365.com/owa/?itemid=${e.id}`,
          })),
        })
      }
      return reply({}, 404)
    })
  )
}

let t: Awaited<ReturnType<typeof createTestDb>>
let alex: string
let bob: string
beforeAll(async () => {
  process.env.GOOGLE_CALENDAR_CLIENT_ID = "google-client"
  process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "google-secret"
  process.env.GOOGLE_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/integrations/google-calendar/callback"
  process.env.OUTLOOK_CALENDAR_CLIENT_ID = "ms-client"
  process.env.OUTLOOK_CALENDAR_CLIENT_SECRET = "ms-secret"
  process.env.OUTLOOK_CALENDAR_REDIRECT_URI = "http://localhost:3000/api/integrations/outlook-calendar/callback"
  t = await createTestDb()
  alex = await t.addUser("Alex")
  bob = await t.addUser("Bob")
})
afterAll(() => t.close())
beforeEach(async () => {
  google.events = [
    // Soccer, weekly (two occurrences), 10:30-1:00 PM New York time (EDT, -04:00).
    { id: "soc_1", recurringEventId: "soc", original: "2026-09-22T10:30:00-04:00", summary: "Soccer Practice", start: "2026-09-22T10:30:00-04:00", end: "2026-09-22T13:00:00-04:00" },
    { id: "soc_2", recurringEventId: "soc", original: "2026-09-29T10:30:00-04:00", summary: "Soccer Practice", start: "2026-09-29T10:30:00-04:00", end: "2026-09-29T13:00:00-04:00" },
    // Happening right now (3:00 PM): 2:45-3:30 PM.
    { id: "call", summary: "Advisor call", start: "2026-09-22T14:45:00-04:00", end: "2026-09-22T15:30:00-04:00" },
    { id: "dentist", summary: "Dentist", start: "2026-09-22T16:00:00-04:00", end: "2026-09-22T17:00:00-04:00" },
  ]
  google.status = 200
  google.refreshStatus = 200
  google.accessCalls = []
  // Outlook: a team meeting tomorrow 18:00-19:15 UTC (2:00-3:15 PM New York).
  outlook.events = [{ id: "AAMk-1", subject: "Team Meeting", start: "2026-09-23T18:00:00", end: "2026-09-23T19:15:00" }]
  outlook.status = 200
  fakeProviders()
  await t.db.delete(calendarConnections)
  await t.db.delete(externalCalendarEvents)
  await saveCalendarConnection(t.db, alex, "google", tokens("google-access"), { externalAccountId: "alex@gmail.com", email: "alex@gmail.com" }, vault)
})
afterEach(() => vi.unstubAllGlobals())

const sync = (provider = googleCalendarProvider, userId = alex) => syncCalendarConnection(t.db, userId, provider, vault, { now: NOW })
const googleRows = async () => (await listExternalEvents(t.db, alex)).filter((e) => e.source === "google")

describe("connection storage", () => {
  it("tokens are stored encrypted, bound to the student and the provider; the summary has none", async () => {
    const [row] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))
    expect(row.accessTokenEncrypted).not.toContain("google-access")
    expect(row.refreshTokenEncrypted).not.toContain("refresh-for")
    expect(await loadCalendarCredentials(t.db, alex, "google", vault)).toMatchObject({ accessToken: "google-access", refreshToken: "refresh-for-google-access" })
    // Copied into Bob's row, Alex's ciphertext doesn't open.
    await t.db.insert(calendarConnections).values({ ...row, id: undefined, userId: bob })
    await expect(loadCalendarCredentials(t.db, bob, "google", vault)).rejects.toMatchObject({ kind: "reconnect" })
    const status = await getCalendarIntegrationStatus(t.db, alex, true)
    expect(JSON.stringify(status)).not.toMatch(/google-access|refresh-for|Encrypted/)
    expect(status.find((s) => s.provider === "google")?.connection).toMatchObject({ status: "connected", accountEmail: "alex@gmail.com" })
    expect(status.find((s) => s.provider === "outlook")?.connection).toBeNull()
    await t.db.delete(calendarConnections).where(eq(calendarConnections.userId, bob))
  })
})

describe("Google Calendar sync", () => {
  it("adds events (all pages, recurring occurrences), records the sync time", async () => {
    expect(await sync()).toMatchObject({ added: 4, updated: 0, removed: 0 })
    const rows = await googleRows()
    expect(rows.map((r) => r.title).sort()).toEqual(["Advisor call", "Dentist", "Soccer Practice", "Soccer Practice"])
    const [connection] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))
    expect(connection.lastSyncedAt?.toISOString()).toBe(NOW.toISOString())
    // External recurring events stay external: no Student OS weekly commitment was created.
    expect((await loadAppData(t.db, alex)).recurringCommitments).toEqual([])
  })

  it("syncing again never duplicates; changes update the same row; deletions are removed", async () => {
    await sync()
    const before = await googleRows()
    expect(await sync()).toMatchObject({ added: 0, updated: 0, removed: 0 })
    google.events = google.events.filter((e) => e.id !== "dentist").map((e) => (e.id === "call" ? { ...e, summary: "Advisor call (moved)", start: "2026-09-22T17:30:00-04:00", end: "2026-09-22T18:00:00-04:00" } : e))
    expect(await sync()).toMatchObject({ added: 0, updated: 1, removed: 1 })
    const after = await googleRows()
    expect(after).toHaveLength(3)
    expect(after.find((r) => r.title === "Advisor call (moved)")?.id).toBe(before.find((r) => r.title === "Advisor call")?.id)
    const [dentist] = await t.db.select().from(externalCalendarEvents).where(eq(externalCalendarEvents.externalId, "dentist@google.com"))
    expect(dentist.removedAt).not.toBeNull()
  })

  it("an expired access token is refreshed and the new one stored encrypted", async () => {
    await saveCalendarConnection(t.db, alex, "google", tokens("google-old", -60_000), { externalAccountId: null, email: null }, vault)
    await sync()
    expect(google.accessCalls.every((auth) => auth === "Bearer google-access-2")).toBe(true)
    expect((await loadCalendarCredentials(t.db, alex, "google", vault)).accessToken).toBe("google-access-2")
  })

  it("a 401 mid-sync refreshes once and retries", async () => {
    await saveCalendarConnection(t.db, alex, "google", tokens("google-expired"), { externalAccountId: null, email: null }, vault)
    expect((await sync()).added).toBe(4)
    expect(google.accessCalls[0]).toBe("Bearer google-expired")
  })

  it("revoked access: 'needs attention', existing events kept, a safe message", async () => {
    await sync()
    await saveCalendarConnection(t.db, alex, "google", tokens("google-old", -60_000), { externalAccountId: null, email: null }, vault)
    google.refreshStatus = 400
    vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(sync()).rejects.toMatchObject({ kind: "reconnect", message: "Your Google Calendar connection expired or was removed. Please connect Google Calendar again." })
    const [connection] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))
    expect(connection.status).toBe("needs_reauth")
    expect(await googleRows()).toHaveLength(4)
  })

  it("rate limits and outages: an error on the connection, nothing lost", async () => {
    await sync()
    vi.spyOn(console, "error").mockImplementation(() => {})
    google.status = 429
    await expect(sync()).rejects.toMatchObject({ kind: "rate-limited" })
    google.status = 503
    await expect(sync()).rejects.toMatchObject({ kind: "unavailable" })
    const [connection] = await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))
    expect(connection).toMatchObject({ status: "error", lastSyncError: "Google Calendar didn't respond. Please try again in a moment." })
    expect(await googleRows()).toHaveLength(4)
  })
})

describe("all sources together", () => {
  async function connectEverything() {
    await saveCalendarConnection(t.db, alex, "outlook", tokens("ms-access"), { externalAccountId: "cal", email: "alex@school.edu" }, vault)
    await sync()
    await sync(outlookCalendarProvider)
    // Canvas and Blackboard calendar events (as their feed syncs save them).
    await syncExternalCalendar(t.db, alex, "canvas", [
      { source: "canvas", externalId: "calendar-event-1", title: "CSC215", description: null, startsAt: "2026-09-22T18:00:00.000Z", endsAt: "2026-09-22T18:30:00.000Z", location: null, url: null },
    ], { now: NOW })
    await syncExternalCalendar(t.db, alex, "blackboard", [
      { source: "blackboard", externalId: "bb-1", title: "Office hours", description: null, startsAt: "2026-09-23T14:00:00.000Z", endsAt: "2026-09-23T15:00:00.000Z", location: null, url: null },
    ], { now: NOW })
  }

  it("Google + Outlook + Canvas + Blackboard coexist, each once, labelled by source", async () => {
    await connectEverything()
    const events = await listExternalEvents(t.db, alex)
    expect(events.map((e) => e.source).sort()).toEqual(["blackboard", "canvas", "google", "google", "google", "google", "outlook"])
    // Syncing everything again adds nothing.
    expect(await sync()).toMatchObject({ added: 0 })
    expect(await sync(outlookCalendarProvider)).toMatchObject({ added: 0 })
    expect(await listExternalEvents(t.db, alex)).toHaveLength(7)
  })

  it("one provider failing doesn't touch the others", async () => {
    await connectEverything()
    outlook.status = 401
    vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(sync(outlookCalendarProvider)).rejects.toMatchObject({ kind: "reconnect" })
    expect(await sync()).toMatchObject({ added: 0 })
    const status = await getCalendarIntegrationStatus(t.db, alex, true)
    expect(status.find((s) => s.provider === "google")?.connection?.status).toBe("connected")
    expect(status.find((s) => s.provider === "outlook")?.connection?.status).toBe("needs_reauth")
    expect(await listExternalEvents(t.db, alex)).toHaveLength(7)
  })

  it("disconnecting Google removes only Google's events and connection", async () => {
    await connectEverything()
    const course = await createCourse(t.db, alex, { code: `C${Date.now()}`, name: "Databases", professor: "", description: "" })
    const task = await createTask(t.db, alex, { courseId: course.id, title: "Project", description: "", type: "project", dueDate: "2026-09-25", priority: "high", estimateMinutes: 60, status: "not_started" })
    const own = await createEvent(t.db, alex, { title: "Club", date: "2026-09-24", startTime: "18:00", endTime: "19:00", type: "personal" })
    expect(await deleteCalendarConnection(t.db, alex, "google")).toBe(true)
    await deleteExternalEventsFrom(t.db, alex, "google")
    const data = await loadAppData(t.db, alex)
    expect(data.externalEvents.map((e) => e.source).sort()).toEqual(["blackboard", "canvas", "outlook"])
    expect(data.tasks.some((x) => x.id === task.id)).toBe(true)
    expect(data.events.some((x) => x.id === own.id)).toBe(true)
    expect((await getCalendarIntegrationStatus(t.db, alex, true)).find((s) => s.provider === "google")?.connection).toBeNull()
  })

  it("user isolation: syncing Alex's calendar never writes Bob's rows, and Bob can't sync without his own connection", async () => {
    await sync()
    expect(await listExternalEvents(t.db, bob)).toEqual([])
    vi.spyOn(console, "error").mockImplementation(() => {})
    await expect(sync(googleCalendarProvider, bob)).rejects.toMatchObject({ kind: "reconnect" })
    expect(await listExternalEvents(t.db, bob)).toEqual([])
  })
})

describe("the rest of Student OS uses the same events", () => {
  // The student's wall clock in New York, as the app computes it.
  const localNow = dateFromWallClock(wallClockIn(NY, NOW))
  const today = toDateKey(localNow)

  async function planner() {
    await saveCalendarConnection(t.db, alex, "outlook", tokens("ms-access"), { externalAccountId: null, email: null }, vault)
    await sync()
    await sync(outlookCalendarProvider)
    const data = await loadAppData(t.db, alex)
    const input = plannerInputFor({ ...data, timeZone: NY }, localNow)
    return { data, input, planner: createPlanner(input) }
  }

  it("time zones: Google's offsets and Outlook's UTC land on the right local times", async () => {
    const { data } = await planner()
    const items = externalEventsAsCalendarItems(data.externalEvents, NY)
    expect(items.find((i) => i.title === "Dentist")).toMatchObject({ date: "2026-09-22", startTime: "16:00", endTime: "17:00", source: "google" })
    expect(items.find((i) => i.title === "Team Meeting")).toMatchObject({ date: "2026-09-23", startTime: "14:00", endTime: "15:15", source: "outlook" })
    // The same instants in Los Angeles: three hours earlier.
    expect(externalEventsAsCalendarItems(data.externalEvents, "America/Los_Angeles").find((i) => i.title === "Dentist")).toMatchObject({ startTime: "13:00" })
  })

  it("Dashboard / Calendar: today's schedule includes them", async () => {
    const { input, data } = await planner()
    const titles = scheduleBetween(input.events, data.recurringCommitments, today, today).map((e) => e.title)
    expect(titles).toEqual(expect.arrayContaining(["Soccer Practice", "Advisor call", "Dentist"]))
  })

  it("Planner: Google and Outlook events are busy time; no study is planned over them", async () => {
    const { input, planner: p, data } = await planner()
    const course = await createCourse(t.db, alex, { code: `P${Date.now()}`, name: "Planning", professor: "", description: "" })
    await createTask(t.db, alex, { courseId: course.id, title: "Essay", description: "", type: "paper", dueDate: "2026-09-24", priority: "high", estimateMinutes: 240, status: "not_started" })
    const withTask = createPlanner(plannerInputFor({ ...(await loadAppData(t.db, alex)), timeZone: NY }, localNow))
    const busy = input.events.filter((e) => e.source === "google" || e.source === "outlook")
    for (const date of [today, "2026-09-23"]) {
      for (const session of withTask.planFor(date).suggestions) {
        for (const event of busy.filter((e) => e.date === date)) {
          expect(session.endTime <= event.startTime || session.startTime >= event.endTime).toBe(true)
        }
      }
    }
    const free = dayAvailability("2026-09-23", input.events, data.recurringCommitments, localNow, p.settings).free
    expect(free.some((b) => b.start < 15 * 60 + 15 && b.end > 14 * 60)).toBe(false)
  })

  it("What should I do now?: busy in the Google event, until it ends", async () => {
    const { input, planner: p, data } = await planner()
    const answer = whatNow({ planner: p, now: localNow, today, schedule: scheduleBetween(input.events, data.recurringCommitments, today, today), events: input.events, tasks: data.tasks })
    expect(answer).toMatchObject({ kind: "busy", until: "15:30", event: { title: "Advisor call", source: "google" } })
  })

  it("reminders: an upcoming Google event, named with its source, respecting preferences", async () => {
    const { data } = await planner()
    const at = new Date("2026-09-22T19:40:00Z") // 3:40 PM, 20 minutes before the dentist
    const input = { now: at, timeZone: NY, studyStart: "08:00", tasks: [], studySessions: [], events: [], commitments: [], externalEvents: data.externalEvents, plan: null }
    const reminders = generateNotifications({ ...input, preferences: DEFAULT_NOTIFICATION_PREFERENCES })
    const dentist = reminders.find((r) => r.type === "event_upcoming" && r.message.includes("Dentist"))
    expect(dentist).toMatchObject({ title: "Google Calendar event", message: "Dentist starts in 20 minutes." })
    expect(generateNotifications({ ...input, preferences: { ...DEFAULT_NOTIFICATION_PREFERENCES, eventReminders: false } }).some((r) => r.type === "event_upcoming")).toBe(false)
  })
})
