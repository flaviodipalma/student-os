import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { listLmsConnections, saveLmsConnection } from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { verifyOAuthState } from "@/server/integrations/lms/oauth-state"
import { createTestDb } from "@/server/test-utils/test-db"

// The integration server actions, as the browser calls them. The signed-in
// student comes from the (mocked) verified session, never from the request.
// Canvas is a fake fetch serving TEST FIXTURES shaped after the documented
// Canvas API fields; no real Canvas is contacted.

const session = vi.hoisted(() => ({
  userId: null as string | null,
  db: null as unknown,
  cookies: new Map<string, { value: string; options: Record<string, unknown> }>(),
}))
vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null),
}))
vi.mock("@/server/db", () => ({ getDb: () => session.db }))
vi.mock("@/server/student-clock", () => ({ getStudentTimeZone: async () => "America/New_York" }))
vi.mock("next/headers", () => ({
  cookies: async () => ({
    set: (name: string, value: string, options: Record<string, unknown>) => session.cookies.set(name, { value, options }),
    get: (name: string) => (session.cookies.has(name) ? { name, value: session.cookies.get(name)!.value } : undefined),
  }),
}))

const BASE = "https://school.instructure.com"
const canvasFixture = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
  const url = new URL(String(input))
  if (url.origin !== BASE) throw new TypeError("fetch failed")
  if (init.method === "DELETE") return new Response("{}")
  if (url.pathname === "/feeds/calendars/user_secretfeed.ics") {
    return new Response(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:event-assignment-1",
        "SUMMARY:Project 1 [CSC 215]",
        "DTSTART;TZID=UTC:20260926T035900",
        `URL;VALUE=URI:${BASE}/calendar?include_contexts=course_215&month=09&year=2026#assignment_1`,
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n"),
      { headers: { "Content-Type": "text/calendar" } }
    )
  }
  const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
  if (url.pathname === "/api/v1/courses") return json([{ id: 215, name: "Data Structures", course_code: "CSC 215", workflow_state: "available" }])
  if (url.pathname === "/api/v1/courses/215/assignments") {
    return json([{ id: 1, name: "Project 1", due_at: "2026-09-26T03:59:00Z", html_url: `${BASE}/courses/215/assignments/1`, published: true }])
  }
  return new Response("{}", { status: 404 })
}) as typeof fetch

const { connectCanvasAction, connectCanvasFeedAction, disconnectLmsAction, syncLmsAction } = await import("./integrations")

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  session.db = t.db as Database
  session.cookies.clear()
  vi.stubEnv("LMS_TOKEN_ENCRYPTION_KEY", randomBytes(32).toString("base64"))
  vi.stubEnv("CANVAS_CLIENT_ID", "test-client-id")
  vi.stubEnv("CANVAS_CLIENT_SECRET", "test-client-secret")
  vi.stubEnv("CANVAS_REDIRECT_URI", "http://localhost:3000/api/integrations/canvas/callback")
  vi.stubGlobal("fetch", vi.fn(canvasFixture))
})
afterEach(() => {
  session.userId = null
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  return t.close()
})

async function connectedStudent(name: string) {
  const user = await t.addUser(name)
  await saveLmsConnection(
    t.db,
    user,
    "canvas",
    { accessToken: "secret-access-token", refreshToken: "secret-refresh-token", expiresAt: new Date(Date.now() + 3600_000), externalUserId: "42", baseUrl: BASE },
    getCredentialVault()
  )
  return user
}

describe("Canvas server actions", () => {
  it("refuse to do anything when nobody is signed in", async () => {
    expect(await syncLmsAction("canvas")).toMatchObject({ ok: false, code: "unauthorized" })
    expect(await disconnectLmsAction("canvas")).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("sync the signed-in student's own Canvas, and never return tokens", async () => {
    session.userId = await connectedStudent("Alice")
    const outcome = await syncLmsAction("canvas")
    expect(outcome).toMatchObject({ ok: true, data: { result: { coursesCreated: 1, assignmentsCreated: 1 } } })
    if (!outcome.ok) throw new Error("sync failed")
    expect(outcome.data.tasks).toEqual([expect.objectContaining({ title: "Project 1", dueDate: "2026-09-25" })])
    expect(JSON.stringify(outcome)).not.toMatch(/secret-access-token|secret-refresh-token|test-client-secret/)
    // Canvas was called with the token in the header only.
    const calls = vi.mocked(fetch).mock.calls
    expect(calls.every(([url]) => !String(url).includes("secret-access-token"))).toBe(true)
  })

  it("can't sync or disconnect another student's connection", async () => {
    const alice = await connectedStudent("Alice")
    session.userId = await t.addUser("Bob")
    expect(await syncLmsAction("canvas")).toMatchObject({ ok: false, code: "not-found" })
    expect(await disconnectLmsAction("canvas")).toMatchObject({ ok: false, code: "not-found" })
    expect(await listLmsConnections(t.db, alice)).toHaveLength(1)
  })

  it("reject an unknown provider", async () => {
    session.userId = await connectedStudent("Alice")
    expect(await syncLmsAction("moodle")).toMatchObject({ ok: false, code: "validation" })
  })

  it("disconnect removes the connection but keeps imported data", async () => {
    session.userId = await connectedStudent("Alice")
    await syncLmsAction("canvas")
    expect(await disconnectLmsAction("canvas")).toEqual({ ok: true, data: null })
    expect(await listLmsConnections(t.db, session.userId)).toEqual([])
    const outcome = await syncLmsAction("canvas")
    expect(outcome).toMatchObject({ ok: false, code: "not-found" })
  })
})

describe("Connect Canvas", () => {
  const form = (canvasUrl: string) => {
    const data = new FormData()
    data.set("canvasUrl", canvasUrl)
    return data
  }

  it("refuses an address that isn't an allowed Canvas, without redirecting or setting a cookie", async () => {
    session.userId = await t.addUser("Alice")
    expect(await connectCanvasAction({ error: null }, form("https://evil.example.com"))).toEqual({
      error: "Student OS can't connect to evil.example.com yet. Check the address, or ask your admin to allow it.",
    })
    expect(session.cookies.size).toBe(0)
  })

  it("sets a single-use state cookie and sends the student to their Canvas", async () => {
    const alice = await t.addUser("Alice")
    session.userId = alice
    const error = await connectCanvasAction({ error: null }, form("school.instructure.com")).catch((e) => e)
    // redirect() works by throwing; its target is in the digest.
    const target = new URL(String(error.digest).split(";")[2])
    expect(target.origin + target.pathname).toBe(`${BASE}/login/oauth2/auth`)
    expect(target.searchParams.get("client_id")).toBe("test-client-id")
    expect(target.toString()).not.toContain("test-client-secret")

    const cookie = session.cookies.get("lms_oauth_canvas")!
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/integrations/canvas", maxAge: 600 })
    const verified = verifyOAuthState(
      { provider: "canvas", userId: alice, state: target.searchParams.get("state"), cookieValue: cookie.value },
      getCredentialVault()
    )
    expect(verified).toEqual({ baseUrl: BASE })
  })
})

describe("Connect Canvas with the calendar feed", () => {
  const form = (feedUrl: string) => {
    const data = new FormData()
    data.set("feedUrl", feedUrl)
    return data
  }
  const FEED = `${BASE}/feeds/calendars/user_secretfeed.ics`

  it("saves a working feed link (encrypted) and syncs through it; the link never comes back", async () => {
    const alice = await t.addUser("Alice")
    session.userId = alice
    expect(await connectCanvasFeedAction({ error: null, connected: false }, form(FEED))).toEqual({ error: null, connected: true })
    const [summary] = await listLmsConnections(t.db, alice)
    expect(summary).toMatchObject({ provider: "canvas", method: "calendar_feed", status: "connected" })
    expect(JSON.stringify(summary)).not.toContain("secretfeed")

    const outcome = await syncLmsAction("canvas")
    expect(outcome).toMatchObject({ ok: true, data: { result: { coursesCreated: 1, assignmentsCreated: 1 } } })
    expect(JSON.stringify(outcome)).not.toContain("secretfeed")
  })

  it("refuses a link that isn't a Canvas feed, or doesn't work, without saving anything", async () => {
    session.userId = await t.addUser("Alice")
    const bad = await connectCanvasFeedAction({ error: null, connected: false }, form("https://evil.example.com/feeds/calendars/user_x.ics"))
    expect(bad.connected).toBe(false)
    const dead = await connectCanvasFeedAction({ error: null, connected: false }, form(`${BASE}/feeds/calendars/user_unknown.ics`))
    expect(dead).toEqual({ error: "This Canvas calendar feed link no longer works. Paste a new one from Canvas.", connected: false })
    expect(await listLmsConnections(t.db, session.userId)).toEqual([])
  })

  it("requires a signed-in student", async () => {
    expect(await connectCanvasFeedAction({ error: null, connected: false }, form(FEED))).toEqual({
      error: "Your session has expired. Please log in again.",
      connected: false,
    })
  })
})
