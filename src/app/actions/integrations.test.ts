import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { listLmsConnections, saveLmsConnection } from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { verifyOAuthState } from "@/server/integrations/lms/oauth-state"
import {
  BLACKBOARD_BASE,
  BLACKBOARD_TEST_APP,
  BLACKBOARD_USER_ID,
  bbColumn,
  bbMembership,
  fakeBlackboard,
} from "@/server/test-utils/fake-blackboard"
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

const { connectBlackboardAction, connectBlackboardFeedAction, connectCanvasAction, connectCanvasFeedAction, disconnectLmsAction, syncLmsAction } =
  await import("./integrations")
const { handleLmsCallback } = await import("@/server/integrations/lms/oauth-callback")
const { NextRequest } = await import("next/server")

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
    expect(verified).toEqual({ baseUrl: BASE, codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) })
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

// ---- Blackboard: connect, callback, sync, disconnect ------------------------------------

describe("Blackboard", () => {
  let blackboard: ReturnType<typeof fakeBlackboard>
  beforeEach(() => {
    vi.stubEnv("BLACKBOARD_CLIENT_ID", BLACKBOARD_TEST_APP.clientId)
    vi.stubEnv("BLACKBOARD_CLIENT_SECRET", BLACKBOARD_TEST_APP.clientSecret)
    vi.stubEnv("BLACKBOARD_REDIRECT_URI", "http://localhost:3000/api/integrations/blackboard/callback")
    blackboard = fakeBlackboard({
      memberships: [bbMembership("_215_1", {}, { name: "Biology", courseId: "BIO-215" })],
      columns: { "_215_1": [bbColumn("_1_1", { name: "Lab report" })] },
    })
    // Blackboard requests go to the fake Learn server, anything else to the Canvas fixture.
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        new URL(String(input)).origin === BLACKBOARD_BASE ? blackboard.fetch(input, init) : canvasFixture(input, init)
      )
    )
  })

  const form = (blackboardUrl: string) => {
    const data = new FormData()
    data.set("blackboardUrl", blackboardUrl)
    return data
  }

  // Starts "Connect Blackboard" and returns where the student is sent.
  async function start() {
    const error = await connectBlackboardAction({ error: null }, form("school.blackboard.com")).catch((e) => e)
    return new URL(String(error.digest).split(";")[2])
  }

  // Blackboard sends the student back to the callback route.
  function callback(params: Record<string, string>, cookie = session.cookies.get("lms_oauth_blackboard")?.value) {
    const url = new URL("http://localhost:3000/api/integrations/blackboard/callback")
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    const headers = new Headers()
    if (cookie) headers.set("cookie", `lms_oauth_blackboard=${cookie}`)
    return handleLmsCallback(new NextRequest(url, { headers }), "blackboard")
  }
  const outcome = (response: Response) => new URL(response.headers.get("location")!).searchParams.get("blackboard")

  it("refuses an address that isn't an allowed Blackboard, without redirecting or setting a cookie", async () => {
    session.userId = await t.addUser("Alice")
    expect(await connectBlackboardAction({ error: null }, form("https://evil.example.com"))).toEqual({
      error: "Student OS can't connect to evil.example.com yet. Check the address, or ask your admin to allow it.",
    })
    expect(await connectBlackboardAction({ error: null }, form("not an address"))).toEqual({
      error: "Enter your school's Blackboard address, like school.blackboard.com.",
    })
    expect(session.cookies.size).toBe(0)
  })

  it("says so when the server has no Blackboard app configured", async () => {
    vi.stubEnv("BLACKBOARD_CLIENT_SECRET", "")
    session.userId = await t.addUser("Alice")
    expect(await connectBlackboardAction({ error: null }, form("school.blackboard.com"))).toEqual({
      error: "Blackboard isn't set up on this server yet.",
    })
  })

  it("connects end to end: state + PKCE cookie, sign-in at Blackboard, callback, encrypted tokens, first sync", async () => {
    const alice = await t.addUser("Alice")
    session.userId = alice
    const target = await start()
    expect(target.origin + target.pathname).toBe(`${BLACKBOARD_BASE}/learn/api/public/v1/oauth2/authorizationcode`)
    expect(target.searchParams.get("client_id")).toBe(BLACKBOARD_TEST_APP.clientId)
    expect(target.searchParams.get("code_challenge_method")).toBe("S256")
    expect(target.toString()).not.toContain(BLACKBOARD_TEST_APP.clientSecret)
    const cookie = session.cookies.get("lms_oauth_blackboard")!
    expect(cookie.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/api/integrations/blackboard", maxAge: 600 })

    // The fake Learn server checks the PKCE verifier against this attempt's challenge.
    const verified = verifyOAuthState(
      { provider: "blackboard", userId: alice, state: target.searchParams.get("state"), cookieValue: cookie.value },
      getCredentialVault()
    )!
    blackboard = fakeBlackboard({ ...blackboard.state, codeVerifier: verified.codeVerifier, validTokens: ["bb-access-1"] })

    const response = await callback({ code: "good-code", state: target.searchParams.get("state")! })
    expect(outcome(response)).toBe("connected")
    // Nothing sensitive in the redirect, and the single-use cookie is cleared.
    expect(response.headers.get("location")).not.toMatch(/bb-access|bb-refresh|good-code/)
    expect(response.headers.get("set-cookie")).toMatch(/lms_oauth_blackboard=;/)

    const [summary] = await listLmsConnections(t.db, alice)
    expect(summary).toMatchObject({ provider: "blackboard", method: "oauth", status: "connected", lastSyncedAt: null })
    expect(JSON.stringify(summary)).not.toMatch(/bb-access|bb-refresh|_42_1/)

    const synced = await syncLmsAction("blackboard")
    expect(synced).toMatchObject({ ok: true, data: { result: { provider: "blackboard", coursesCreated: 1, assignmentsCreated: 1 } } })
    if (!synced.ok) throw new Error("sync failed")
    expect(synced.data.tasks).toEqual([expect.objectContaining({ title: "Lab report", dueDate: "2026-09-25" })])
    expect(JSON.stringify(synced)).not.toMatch(/bb-access|bb-refresh|test-bb-secret/)
    // Learn was read as the student (their primary id), with the token only in the header.
    expect(blackboard.requests.some((r) => r.url.pathname.includes(`/users/${BLACKBOARD_USER_ID}/courses`))).toBe(true)
    expect(vi.mocked(fetch).mock.calls.every(([url]) => !String(url).includes("bb-access"))).toBe(true)

    expect(await disconnectLmsAction("blackboard")).toEqual({ ok: true, data: null })
    expect(await listLmsConnections(t.db, alice)).toEqual([])
  })

  it("rejects a callback with a wrong or missing state, or from another student", async () => {
    const alice = await t.addUser("Alice")
    session.userId = alice
    const target = await start()
    const state = target.searchParams.get("state")!
    expect(outcome(await callback({ code: "good-code", state: "forged" }))).toBe("invalid_state")
    expect(outcome(await callback({ code: "good-code", state }, ""))).toBe("invalid_state")
    session.userId = await t.addUser("Mallory")
    expect(outcome(await callback({ code: "good-code", state }))).toBe("invalid_state")
    expect(await listLmsConnections(t.db, alice)).toEqual([])
    expect(blackboard.requests.filter((r) => r.url.pathname.endsWith("/oauth2/token"))).toEqual([])
  })

  it("reports a canceled sign-in, an unapproved app and a failed exchange as short codes only", async () => {
    session.userId = await t.addUser("Alice")
    expect(outcome(await callback({ error: "access_denied" }))).toBe("denied")

    let target = await start()
    blackboard.state.approved = false
    expect(outcome(await callback({ code: "good-code", state: target.searchParams.get("state")! }))).toBe("not_approved")

    blackboard.state.approved = true
    target = await start()
    expect(outcome(await callback({ code: "bad-code", state: target.searchParams.get("state")! }))).toBe("error")
    expect(await listLmsConnections(t.db, session.userId)).toEqual([])
  })

  it("connects with the calendar link (no admin approval), syncs through it, and never returns the link", async () => {
    const FEED = `${BLACKBOARD_BASE}/webapps/calendar/calendarFeed/secretfeedtoken0123456789abcdef/learn.ics`
    const ics = [
      "BEGIN:VCALENDAR",
      "PRODID:-//Blackboard//EN",
      "BEGIN:VEVENT",
      // A week from now, so the item is always upcoming.
      `DTSTART;TZID=America/New_York:${new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10).replace(/-/g, "")}T235900`,
      "SUMMARY:Lab 4",
      "UID:_blackboard.platform.gradebook2.GradableItem-_1001_1",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        String(input) === FEED ? new Response(ics, { headers: { "Content-Type": "text/calendar" } }) : new Response("", { status: 404 })
      )
    )
    const alice = await t.addUser("Alice")
    session.userId = alice
    const data = new FormData()
    data.set("feedUrl", FEED)
    expect(await connectBlackboardFeedAction({ error: null, connected: false }, data)).toEqual({ error: null, connected: true })
    const [summary] = await listLmsConnections(t.db, alice)
    expect(summary).toMatchObject({ provider: "blackboard", method: "calendar_feed", status: "connected" })
    expect(JSON.stringify(summary)).not.toContain("secretfeedtoken")

    const synced = await syncLmsAction("blackboard")
    expect(synced).toMatchObject({ ok: true, data: { result: { coursesCreated: 1, assignmentsCreated: 1 } } })
    expect(JSON.stringify(synced)).not.toContain("secretfeedtoken")

    const bad = new FormData()
    bad.set("feedUrl", "https://evil.example.com/webapps/calendar/calendarFeed/x/learn.ics")
    session.userId = await t.addUser("Bob")
    expect((await connectBlackboardFeedAction({ error: null, connected: false }, bad)).connected).toBe(false)
    expect(await listLmsConnections(t.db, session.userId)).toEqual([])
  })

  it("sends a signed-out visitor to log in, without touching Blackboard", async () => {
    const response = await callback({ code: "good-code", state: "x" })
    expect(new URL(response.headers.get("location")!).pathname).toBe("/login")
    expect(blackboard.requests).toEqual([])
  })
})
