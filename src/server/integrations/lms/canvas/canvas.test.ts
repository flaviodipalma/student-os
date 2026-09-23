import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generatePlan } from "@/lib/planner"
import { lmsConnections } from "../../../db/schema"
import { createTestDb } from "../../../test-utils/test-db"
import { loadAppData } from "../../../services/app-data"
import { updateTask } from "../../../services/tasks"
import { listLmsConnections, loadLmsCredentials, saveLmsConnection } from "../connections"
import { createCredentialVault } from "../credential-vault"
import { createOAuthState, verifyOAuthState } from "../oauth-state"
import { LmsError, type LmsAccess } from "../provider"
import { syncLms } from "../sync"
import { createLmsAccess } from "../token-service"
import { CanvasApiClient, nextPageUrl } from "./api-client"
import { CanvasProvider } from "./canvas-provider"
import { CANVAS_SCOPES, parseCanvasBaseUrl, type CanvasConfig } from "./config"
import { canvasAssignmentToLms, canvasCourseToLms, canvasDueToLocal, htmlToText } from "./mapping"
import { canvasAuthorizationUrl, exchangeCanvasCode, refreshCanvasToken, revokeCanvasToken } from "./oauth"

// The Canvas integration without touching a real Canvas. HTTP goes to a fake
// fetch that serves TEST FIXTURES: hand-written responses shaped after the
// fields documented in the Canvas REST API (OAuth2, Courses, Assignments).
// They are not real Canvas data and aren't used anywhere outside these tests.

const BASE = "https://school.instructure.com"
const config: CanvasConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/api/integrations/canvas/callback",
  allowedHosts: ["*.instructure.com"],
  scopes: CANVAS_SCOPES,
}
const vault = createCredentialVault(randomBytes(32))

type Recorded = { method: string; url: URL; headers: Headers; body: string }

// ---- A fake Canvas (test fixture) ------------------------------------------------
function fakeCanvas(fixture: {
  courses?: unknown[]
  assignments?: Record<string, unknown[] | number>
  pageSize?: number
  validTokens?: string[]
}) {
  const requests: Recorded[] = []
  const state = {
    courses: fixture.courses ?? [],
    assignments: fixture.assignments ?? {},
    validTokens: new Set(fixture.validTokens ?? ["canvas-access-1"]),
    issued: 1,
  }
  const pageSize = fixture.pageSize ?? 100
  const json = (body: unknown, init: ResponseInit = {}) =>
    new Response(JSON.stringify(body), { ...init, headers: { "Content-Type": "application/json", ...init.headers } })

  function page(url: URL, items: unknown[]) {
    const number = Number(url.searchParams.get("page") ?? "1")
    const slice = items.slice((number - 1) * pageSize, number * pageSize)
    const headers: Record<string, string> = {}
    if (number * pageSize < items.length) {
      const next = new URL(url)
      next.searchParams.set("page", String(number + 1))
      headers.Link = `<${url.toString()}>; rel="current", <${next.toString()}>; rel="next"`
    }
    return json(slice, { headers })
  }

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    const body = init.body ? String(init.body) : ""
    requests.push({ method: init.method ?? "GET", url, headers, body })
    if (url.origin !== BASE) throw new TypeError("fetch failed")

    if (url.pathname === "/login/oauth2/token" && init.method === "POST") {
      const form = new URLSearchParams(body)
      if (form.get("client_secret") !== config.clientSecret) return json({ error: "invalid_client" }, { status: 401 })
      if (form.get("grant_type") === "authorization_code" && form.get("code") === "good-code") {
        return json({ access_token: "canvas-access-1", token_type: "Bearer", refresh_token: "canvas-refresh", expires_in: 3600, user: { id: 42, name: "Alex" } })
      }
      if (form.get("grant_type") === "refresh_token" && form.get("refresh_token") === "canvas-refresh") {
        const token = `canvas-access-${++state.issued}`
        state.validTokens.add(token)
        return json({ access_token: token, token_type: "Bearer", expires_in: 3600, user: { id: 42 } })
      }
      return json({ error: "invalid_grant" }, { status: 400 })
    }
    if (url.pathname === "/login/oauth2/token" && init.method === "DELETE") return json({})

    const token = headers.get("authorization")?.replace(/^Bearer /, "")
    if (!token || !state.validTokens.has(token)) return json({ errors: [{ message: "Invalid access token." }] }, { status: 401 })
    if (url.pathname === "/api/v1/courses") return page(url, state.courses)
    const match = url.pathname.match(/^\/api\/v1\/courses\/([^/]+)\/assignments$/)
    if (match) {
      const items = state.assignments[match[1]]
      if (typeof items === "number") return json({ errors: [] }, { status: items })
      return page(url, items ?? [])
    }
    return json({ errors: [] }, { status: 404 })
  }) as typeof fetch

  return { fetch: fetchImpl, requests, state }
}

const course = (id: number, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Course ${id}`,
  course_code: `CSC${id}`,
  workflow_state: "available",
  teachers: [{ display_name: "Prof. Smith" }],
  ...overrides,
})
const assignment = (id: number, courseId: number, overrides: Record<string, unknown> = {}) => ({
  id,
  course_id: courseId,
  name: `Assignment ${id}`,
  description: "<p>Read <b>chapter 3</b> &amp; answer</p>",
  due_at: "2026-09-26T03:59:00Z", // Friday 11:59 PM in New York
  html_url: `${BASE}/courses/${courseId}/assignments/${id}`,
  submission_types: ["online_upload"],
  published: true,
  submission: { workflow_state: "unsubmitted" },
  ...overrides,
})
// -------------------------------------------------------------------------------------------

const staticAccess = (fetchToken = "canvas-access-1"): LmsAccess & { refreshes: number } => {
  const access = {
    baseUrl: BASE,
    timeZone: "America/New_York",
    refreshes: 0,
    getAccessToken: async () => fetchToken,
    refreshAccessToken: async () => {
      access.refreshes++
      return "canvas-access-2"
    },
  }
  return access
}

describe("Canvas address", () => {
  it("accepts a school's Canvas address, normalized to https://host", () => {
    expect(parseCanvasBaseUrl("quinnipiac.instructure.com", config.allowedHosts)).toBe("https://quinnipiac.instructure.com")
    expect(parseCanvasBaseUrl(" https://School.Instructure.com/courses/1 ", config.allowedHosts)).toBe(BASE)
    expect(parseCanvasBaseUrl("canvas.myschool.edu", ["canvas.myschool.edu"])).toBe("https://canvas.myschool.edu")
  })

  it("refuses anything the client secret mustn't be sent to", () => {
    for (const bad of [
      "",
      "http://school.instructure.com",
      "https://evil.example.com",
      "https://instructure.com",
      "https://school.instructure.com.evil.com",
      "https://user:pass@school.instructure.com",
      "https://school.instructure.com:8443",
      "https://127.0.0.1",
      "localhost",
      "javascript:alert(1)",
    ]) {
      expect(() => parseCanvasBaseUrl(bad, config.allowedHosts), bad).toThrow(LmsError)
    }
  })
})

describe("OAuth", () => {
  it("builds the authorization URL with the state, redirect URI and read-only scopes (no secret)", () => {
    const url = new URL(canvasAuthorizationUrl(config, BASE, "state-123"))
    expect(url.origin + url.pathname).toBe(`${BASE}/login/oauth2/auth`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "test-client-id",
      response_type: "code",
      redirect_uri: config.redirectUri,
      state: "state-123",
      scope: "url:GET|/api/v1/courses url:GET|/api/v1/courses/:course_id/assignments",
      purpose: "Student OS",
    })
    expect(url.toString()).not.toContain("secret")
  })

  it("exchanges the code for tokens on the server", async () => {
    const canvas = fakeCanvas({})
    const now = new Date("2026-09-23T12:00:00Z")
    const tokens = await exchangeCanvasCode(config, BASE, "good-code", canvas.fetch, now)
    expect(tokens).toEqual({
      accessToken: "canvas-access-1",
      refreshToken: "canvas-refresh",
      expiresAt: new Date("2026-09-23T13:00:00Z"),
      externalUserId: "42",
    })
    const [request] = canvas.requests
    expect(request.method).toBe("POST")
    expect(Object.fromEntries(new URLSearchParams(request.body))).toMatchObject({
      grant_type: "authorization_code",
      client_secret: "test-client-secret",
      redirect_uri: config.redirectUri,
      code: "good-code",
    })
  })

  it("reports a rejected code, an outage and an unreadable response safely", async () => {
    const canvas = fakeCanvas({})
    await expect(exchangeCanvasCode(config, BASE, "bad-code", canvas.fetch)).rejects.toMatchObject({ reconnect: true })
    const down = (async () => new Response("oops", { status: 503 })) as typeof fetch
    await expect(exchangeCanvasCode(config, BASE, "good-code", down)).rejects.toThrow("Canvas is temporarily unavailable")
    const garbage = (async () => new Response("{\"hello\":1}", { status: 200 })) as typeof fetch
    await expect(exchangeCanvasCode(config, BASE, "good-code", garbage)).rejects.toThrow("couldn't read")
    const offline = (async () => {
      throw new TypeError("fetch failed")
    }) as typeof fetch
    await expect(exchangeCanvasCode(config, BASE, "good-code", offline)).rejects.toThrow("temporarily unavailable")
  })

  it("refreshes the access token and keeps the same refresh token", async () => {
    const canvas = fakeCanvas({})
    const tokens = await refreshCanvasToken(config, BASE, "canvas-refresh", canvas.fetch)
    expect(tokens.accessToken).toBe("canvas-access-2")
    expect(tokens.refreshToken).toBe("canvas-refresh")
    await expect(refreshCanvasToken(config, BASE, "revoked", canvas.fetch)).rejects.toMatchObject({ reconnect: true })
  })

  it("revokes on disconnect, and never fails if Canvas can't be reached", async () => {
    const canvas = fakeCanvas({})
    await revokeCanvasToken(BASE, "canvas-access-1", canvas.fetch)
    expect(canvas.requests[0]).toMatchObject({ method: "DELETE" })
    expect(canvas.requests[0].headers.get("authorization")).toBe("Bearer canvas-access-1")
    await expect(revokeCanvasToken(BASE, "x", (async () => Promise.reject(new Error("down"))) as typeof fetch)).resolves.toBeUndefined()
  })
})

describe("OAuth state (CSRF protection)", () => {
  const start = new Date("2026-09-23T12:00:00Z")
  const later = (minutes: number) => new Date(start.getTime() + minutes * 60_000)
  const created = createOAuthState({ provider: "canvas", userId: "alice", baseUrl: BASE }, vault, start)
  const check = (overrides: Partial<Parameters<typeof verifyOAuthState>[0]>, now = later(1)) =>
    verifyOAuthState({ provider: "canvas", userId: "alice", state: created.state, cookieValue: created.cookieValue, ...overrides }, vault, now)

  it("is random and doesn't reveal what it protects", () => {
    expect(created.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(createOAuthState({ provider: "canvas", userId: "alice", baseUrl: BASE }, vault).state).not.toBe(created.state)
    expect(created.cookieValue).not.toContain("alice")
    expect(created.cookieValue).not.toContain(created.state)
  })

  it("accepts the matching state from the same student within 10 minutes", () => {
    expect(check({})).toEqual({ baseUrl: BASE })
  })

  it("rejects a different state, another student, another provider, a tampered or missing cookie, or an old one", () => {
    expect(check({ state: "forged" })).toBeNull()
    expect(check({ state: null })).toBeNull()
    expect(check({ userId: "bob" })).toBeNull()
    expect(check({ provider: "blackboard" })).toBeNull()
    expect(check({ cookieValue: undefined })).toBeNull()
    expect(check({ cookieValue: created.cookieValue.slice(0, -4) + "AAAA" })).toBeNull()
    expect(check({}, later(11))).toBeNull()
  })
})

describe("Canvas API client", () => {
  it("sends the token in the Authorization header, never in the URL", async () => {
    const canvas = fakeCanvas({ courses: [course(1)] })
    await new CanvasApiClient(staticAccess(), { fetch: canvas.fetch }).getAll("/courses")
    const [request] = canvas.requests
    expect(request.headers.get("authorization")).toBe("Bearer canvas-access-1")
    expect(request.url.toString()).not.toContain("canvas-access")
    expect(request.url.searchParams.get("per_page")).toBe("100")
  })

  it("follows pagination to the end", async () => {
    const canvas = fakeCanvas({ courses: [1, 2, 3, 4, 5].map((id) => course(id)), pageSize: 2 })
    const items = await new CanvasApiClient(staticAccess(), { fetch: canvas.fetch }).getAll("/courses")
    expect(items).toHaveLength(5)
    expect(canvas.requests).toHaveLength(3)
  })

  it("stops at the page limit, and never follows a next link to another host", async () => {
    const canvas = fakeCanvas({ courses: [1, 2, 3, 4, 5].map((id) => course(id)), pageSize: 1 })
    expect(await new CanvasApiClient(staticAccess(), { fetch: canvas.fetch, maxPages: 2 }).getAll("/courses")).toHaveLength(2)

    const elsewhere = (async (input: RequestInfo | URL) =>
      new Response(JSON.stringify([course(Number(new URL(String(input)).searchParams.get("page") ?? 1))]), {
        headers: { Link: `<https://attacker.example/api/v1/courses?page=2>; rel="next"` },
      })) as typeof fetch
    expect(await new CanvasApiClient(staticAccess(), { fetch: elsewhere }).getAll("/courses")).toHaveLength(1)
  })

  it("parses Link headers in any case", () => {
    expect(nextPageUrl(`<${BASE}/a?page=1>; rel="current", <${BASE}/a?page=2>; REL="Next"`)).toBe(`${BASE}/a?page=2`)
    expect(nextPageUrl(`<${BASE}/a?page=1>; rel="current"`)).toBeNull()
    expect(nextPageUrl(null)).toBeNull()
  })

  it("on a 401, refreshes the token once and retries", async () => {
    const canvas = fakeCanvas({ courses: [course(1)], validTokens: ["canvas-access-2"] })
    const access = staticAccess("expired-token")
    expect(await new CanvasApiClient(access, { fetch: canvas.fetch }).getAll("/courses")).toHaveLength(1)
    expect(access.refreshes).toBe(1)
    expect(canvas.requests.map((r) => r.headers.get("authorization"))).toEqual(["Bearer expired-token", "Bearer canvas-access-2"])
  })

  it("asks to reconnect if the refreshed token is rejected too", async () => {
    const canvas = fakeCanvas({ courses: [course(1)], validTokens: [] })
    await expect(new CanvasApiClient(staticAccess("x"), { fetch: canvas.fetch }).getAll("/courses")).rejects.toMatchObject({
      message: "Your Canvas connection expired. Please reconnect.",
      reconnect: true,
    })
  })

  it("turns API errors into simple messages", async () => {
    const respond = (status: number, body = "") => (async () => new Response(body, { status })) as typeof fetch
    const get = (fetchImpl: typeof fetch, scope: "course" | "connection" = "connection") =>
      new CanvasApiClient(staticAccess(), { fetch: fetchImpl }).getAll("/courses", [], scope)
    await expect(get(respond(429))).rejects.toThrow("Canvas is busy right now")
    await expect(get(respond(403, "403 Forbidden (Rate Limit Exceeded)"))).rejects.toThrow("Canvas is busy right now")
    await expect(get(respond(403))).rejects.toThrow("didn't allow Student OS to read your courses")
    await expect(get(respond(403), "course")).rejects.toMatchObject({ scope: "course" })
    await expect(get(respond(404))).rejects.toThrow("Canvas wasn't found at that address.")
    await expect(get(respond(500))).rejects.toThrow("Canvas is temporarily unavailable")
    await expect(get(respond(200, "<html>not json</html>"))).rejects.toThrow("couldn't read")
    await expect(get(respond(200, "{\"not\":\"a list\"}"))).rejects.toThrow("couldn't read")
    const timeout = (async () => {
      throw new DOMException("The operation was aborted due to timeout", "TimeoutError")
    }) as typeof fetch
    await expect(get(timeout)).rejects.toThrow("temporarily unavailable")
  })
})

describe("mapping Canvas data", () => {
  it("maps a course; skips deleted, date-restricted and nameless ones", () => {
    expect(canvasCourseToLms(course(215, { name: "Data Structures", course_code: "CSC 215" }))).toEqual({
      provider: "canvas",
      externalId: "215",
      courseCode: "CSC 215",
      courseName: "Data Structures",
      description: null,
      instructor: "Prof. Smith",
      url: null,
    })
    expect(canvasCourseToLms(course(1, { workflow_state: "deleted" }))).toBeNull()
    expect(canvasCourseToLms({ id: 2, access_restricted_by_date: true })).toBeNull()
    expect(canvasCourseToLms({ id: 3 })).toBeNull()
    expect(canvasCourseToLms("not an object")).toBeNull()
  })

  it("maps an assignment: local due date/time, plain-text description, link, type", () => {
    const context = { baseUrl: BASE, timeZone: "America/New_York" }
    expect(canvasAssignmentToLms(assignment(7, 215), "215", context)).toEqual({
      provider: "canvas",
      externalId: "7",
      courseExternalId: "215",
      title: "Assignment 7",
      description: "Read chapter 3 & answer",
      dueDate: "2026-09-25",
      dueTime: "23:59",
      type: "assignment",
      url: `${BASE}/courses/215/assignments/7`,
      estimatedMinutes: null, // never invented
      submissionStatus: "not_submitted",
    })
    expect(canvasAssignmentToLms(assignment(8, 215, { is_quiz_assignment: true }), "215", context)?.type).toBe("quiz")
    expect(canvasAssignmentToLms(assignment(9, 215, { submission: { workflow_state: "graded" } }), "215", context)?.submissionStatus).toBe("graded")
  })

  it("keeps a missing due date missing, and drops unpublished or malformed items", () => {
    const context = { baseUrl: BASE, timeZone: "America/New_York" }
    expect(canvasAssignmentToLms(assignment(1, 215, { due_at: null }), "215", context)).toMatchObject({ dueDate: null, dueTime: null })
    expect(canvasAssignmentToLms(assignment(2, 215, { published: false }), "215", context)).toBeNull()
    expect(canvasAssignmentToLms({ id: 3, name: "" }, "215", context)).toBeNull()
    expect(canvasAssignmentToLms({ name: "no id" }, "215", context)).toBeNull()
  })

  it("only keeps links to the student's own Canvas", () => {
    const context = { baseUrl: BASE, timeZone: undefined }
    expect(canvasAssignmentToLms(assignment(1, 215, { html_url: "https://evil.example.com/x" }), "215", context)?.url).toBeNull()
    expect(canvasAssignmentToLms(assignment(1, 215, { html_url: "javascript:alert(1)" }), "215", context)?.url).toBeNull()
  })

  it("converts UTC due dates to the student's time zone", () => {
    expect(canvasDueToLocal("2026-09-26T03:59:00Z", "America/New_York")).toEqual({ dueDate: "2026-09-25", dueTime: "23:59" })
    expect(canvasDueToLocal("2026-09-26T03:59:00Z", "Asia/Tokyo")).toEqual({ dueDate: "2026-09-26", dueTime: "12:59" })
    expect(canvasDueToLocal("not a date", "UTC")).toBeNull()
  })

  it("strips HTML from descriptions", () => {
    expect(htmlToText("<p>One</p><p>Two &lt;3</p><script>alert(1)</script>")).toBe("One\nTwo <3")
  })
})

// ---- The whole sync, through the real services and a real Postgres ------------------

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const NOW = new Date("2026-09-23T12:00:00Z")

async function connected(name: string, expiresAt = new Date("2026-09-23T13:00:00Z")) {
  const user = await t.addUser(name)
  await saveLmsConnection(
    t.db,
    user,
    "canvas",
    { accessToken: "canvas-access-1", refreshToken: "canvas-refresh", expiresAt, externalUserId: "42", baseUrl: BASE },
    vault
  )
  return user
}

const sync = (user: string, canvas: ReturnType<typeof fakeCanvas>) =>
  syncLms(t.db, user, new CanvasProvider({ fetch: canvas.fetch, config: () => config }), vault, {
    now: NOW,
    timeZone: "America/New_York",
  })

describe("syncing Canvas into Student OS", () => {
  it("imports courses and assignments as normal courses and tasks", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({
      courses: [course(215, { name: "Data Structures", course_code: "CSC 215" }), course(9, { access_restricted_by_date: true })],
      assignments: { "215": [assignment(1, 215), assignment(2, 215, { due_at: null })] },
    })
    const result = await sync(user, canvas)
    expect(result).toMatchObject({ coursesCreated: 1, assignmentsCreated: 1, assignmentsWithoutDueDate: 1, errors: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([
      expect.objectContaining({
        code: "CSC 215",
        name: "Data Structures",
        source: { provider: "canvas", externalId: "215", url: `${BASE}/courses/215` },
      }),
    ])
    expect(data.tasks).toEqual([
      expect.objectContaining({
        title: "Assignment 1",
        dueDate: "2026-09-25",
        dueTime: "23:59",
        priority: "medium",
        estimateMinutes: null, // Canvas has no estimate, so none is invented
        source: {
          provider: "canvas",
          externalId: "1",
          url: `${BASE}/courses/215/assignments/1`,
          submissionStatus: "not_submitted",
        },
      }),
    ])
    // Only reads: every request to the API was a GET.
    expect(canvas.requests.filter((r) => r.url.pathname.startsWith("/api/")).every((r) => r.method === "GET")).toBe(true)
  })

  it("repeat syncs don't duplicate; changes update; removed assignments are kept and reported", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215), assignment(2, 215)] } })
    await sync(user, canvas)
    const again = await sync(user, canvas)
    expect(again).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)

    // Canvas moves assignment 1 and drops assignment 2.
    canvas.state.assignments["215"] = [assignment(1, 215, { due_at: "2026-09-28T03:59:00Z" })]
    const changed = await sync(user, canvas)
    expect(changed).toMatchObject({ assignmentsUpdated: 1, assignmentsMissing: 1, missing: [{ taskId: expect.any(String), title: "Assignment 2" }] })
    const tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.find((task) => task.title === "Assignment 1")?.dueDate).toBe("2026-09-27")
  })

  it("keeps the student's own due date when Canvas changes it too", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } })
    await sync(user, canvas)
    const [task] = (await loadAppData(t.db, user)).tasks
    await updateTask(t.db, user, task.id, { dueDate: "2026-09-26" }) // the student moves it to Saturday
    canvas.state.assignments["215"] = [assignment(1, 215, { due_at: "2026-09-28T03:59:00Z" })] // Canvas: Sunday
    const result = await sync(user, canvas)
    expect(result.conflicts).toEqual([
      { taskId: task.id, title: "Assignment 1", field: "dueDate", studentValue: "2026-09-26", lmsValue: "2026-09-27" },
    ])
    expect((await loadAppData(t.db, user)).tasks[0].dueDate).toBe("2026-09-26")
  })

  it("skips a course Canvas won't show, without losing that course's tasks or the rest", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({
      courses: [course(1), course(2)],
      assignments: { "1": [assignment(10, 1)], "2": [assignment(20, 2)] },
    })
    await sync(user, canvas)
    canvas.state.assignments["2"] = 403
    const result = await sync(user, canvas)
    expect(result.errors).toEqual(["Course 2: Canvas didn't allow Student OS to read this course."])
    expect(result.assignmentsMissing).toBe(0) // not "missing": it just couldn't be read
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)
  })

  it("refreshes an expired token before syncing, and stores the new one encrypted", async () => {
    const user = await connected("Alex", new Date("2026-09-23T11:00:00Z")) // expired an hour ago
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [] }, validTokens: [] })
    await sync(user, canvas)
    expect(canvas.requests[0].body).toContain("grant_type=refresh_token")
    const [row] = await t.db.select().from(lmsConnections)
    expect(row.accessTokenEncrypted).not.toContain("canvas-access")
    expect((await loadLmsCredentials(t.db, user, "canvas", vault)).accessToken).toBe("canvas-access-2")
  })

  it("asks the student to reconnect when the refresh token is rejected", async () => {
    const user = await t.addUser("Alex")
    await saveLmsConnection(
      t.db,
      user,
      "canvas",
      { accessToken: "old", refreshToken: "revoked", expiresAt: new Date("2026-09-23T11:00:00Z"), externalUserId: null, baseUrl: BASE },
      vault
    )
    await expect(sync(user, fakeCanvas({}))).rejects.toThrow("Your Canvas connection expired. Please reconnect.")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ status: "needs_reauth" })
  })

  it("keeps each student's Canvas data separate", async () => {
    const alice = await connected("Alice")
    const bob = await connected("Bob")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } })
    await sync(alice, canvas)
    expect((await loadAppData(t.db, bob)).tasks).toEqual([])
    await sync(bob, canvas)
    const [a, b] = [(await loadAppData(t.db, alice)).tasks[0], (await loadAppData(t.db, bob)).tasks[0]]
    expect(a.id).not.toBe(b.id)
  })

  it("imported Canvas tasks go straight into the Planner", async () => {
    const user = await connected("Alex")
    await sync(user, fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } }))
    const data = await loadAppData(t.db, user)
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId)).toContain(data.tasks[0].id)
  })

  it("the token service never hands out tokens for another student's connection", async () => {
    await connected("Alice")
    const bob = await t.addUser("Bob")
    await expect(createLmsAccess(t.db, bob, new CanvasProvider({ config: () => config }), vault)).rejects.toThrow("doesn't exist")
  })
})

// ---- Keeping Canvas and Student OS in sync over time --------------------------------

describe("syncing over time", () => {
  it("marks tasks done from Canvas only conservatively, and never un-completes", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({
      courses: [course(215)],
      assignments: {
        "215": [
          assignment(1, 215), // not submitted
          assignment(2, 215, { submission: { workflow_state: "graded" } }), // already graded
        ],
      },
    })
    const first = await sync(user, canvas)
    expect(first.assignmentsCompleted).toBe(1)
    let tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks.find((task) => task.title === "Assignment 1")?.status).toBe("not_started")
    expect(tasks.find((task) => task.title === "Assignment 2")?.status).toBe("completed")

    // The student submits assignment 1 in Canvas: the next sync marks it done.
    canvas.state.assignments["215"] = [
      assignment(1, 215, { submission: { workflow_state: "submitted" } }),
      assignment(2, 215, { submission: { workflow_state: "graded" } }),
    ]
    expect((await sync(user, canvas)).assignmentsCompleted).toBe(1)
    tasks = (await loadAppData(t.db, user)).tasks
    const one = tasks.find((task) => task.title === "Assignment 1")!
    expect(one.status).toBe("completed")

    // The student reopens it (e.g. to revise): later syncs leave it open.
    await updateTask(t.db, user, one.id, { status: "in_progress" })
    expect((await sync(user, canvas)).assignmentsCompleted).toBe(0)
    expect((await loadAppData(t.db, user)).tasks.find((task) => task.id === one.id)?.status).toBe("in_progress")
  })

  it("updates Canvas's fields but never the student's: priority, estimate, notes, status", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(215)], assignments: { "215": [assignment(1, 215)] } })
    await sync(user, canvas)
    const [task] = (await loadAppData(t.db, user)).tasks
    expect(task.estimateMinutes).toBeNull()
    await updateTask(t.db, user, task.id, { priority: "critical", estimateMinutes: 150, notes: "Ask about Q3", status: "in_progress" })

    // Canvas renames the assignment, rewrites the description and moves it from Sep 25 to Sep 27.
    canvas.state.assignments["215"] = [
      assignment(1, 215, { name: "Assignment 1 (updated)", description: "<p>New brief</p>", due_at: "2026-09-28T03:59:00Z" }),
    ]
    const result = await sync(user, canvas)
    expect(result).toMatchObject({ assignmentsUpdated: 1, assignmentsCreated: 0, conflicts: [] })
    expect((await loadAppData(t.db, user)).tasks).toEqual([
      expect.objectContaining({
        id: task.id,
        title: "Assignment 1 (updated)",
        description: "New brief",
        dueDate: "2026-09-27",
        priority: "critical",
        estimateMinutes: 150,
        notes: "Ask about Q3",
        status: "in_progress",
      }),
    ])
  })

  it("updates a renamed course, unless the student renamed it; reports courses that left Canvas", async () => {
    const user = await connected("Alex")
    const canvas = fakeCanvas({ courses: [course(1, { name: "Algebra" }), course(2, { name: "Biology" })], assignments: {} })
    await sync(user, canvas)
    const biology = (await loadAppData(t.db, user)).courses.find((c) => c.name === "Biology")!
    await (await import("../../../services/courses")).updateCourse(t.db, user, biology.id, { name: "Bio (my name)" })

    canvas.state.courses = [course(1, { name: "Algebra II" }), course(2, { name: "Biology 101" })]
    expect(await sync(user, canvas)).toMatchObject({ coursesUpdated: 1, coursesCreated: 0 })
    let names = (await loadAppData(t.db, user)).courses.map((c) => c.name).sort()
    expect(names).toEqual(["Algebra II", "Bio (my name)"])

    // The term ends: Canvas stops listing Algebra. It's reported, and kept.
    canvas.state.courses = [course(2, { name: "Biology 101" })]
    const ended = await sync(user, canvas)
    expect(ended.missingCourses.map((c) => c.name)).toEqual(["Algebra II"])
    names = (await loadAppData(t.db, user)).courses.map((c) => c.name).sort()
    expect(names).toEqual(["Algebra II", "Bio (my name)"])
  })

  it("one item that can't be saved doesn't stop the rest (partial failure)", async () => {
    const user = await connected("Alex")
    // Two Canvas courses whose codes are the same to Student OS ("CSC 215" and "CSC215"):
    // the second can't be created, but everything else still syncs.
    const canvas = fakeCanvas({
      courses: [course(1, { course_code: "CSC 215", name: "Data Structures" }), course(2, { course_code: "CSC215", name: "Data Structures (lab)" }), course(3)],
      assignments: { "1": [assignment(10, 1)], "2": [assignment(20, 2)], "3": [assignment(30, 3)] },
    })
    const result = await sync(user, canvas)
    expect(result.coursesCreated).toBe(2)
    expect(result.coursesSkipped).toBe(1)
    expect(result.errors).toEqual(["Data Structures (lab): You already have a course with the code CSC 215."])
    expect(result.assignmentsCreated).toBe(2) // the lab's assignment has no course to go in
    expect((await loadAppData(t.db, user)).tasks.map((task) => task.title).sort()).toEqual(["Assignment 10", "Assignment 30"])
  })

  it("keeps due dates right around midnight and across time zones", () => {
    const ny = "America/New_York"
    expect(canvasDueToLocal("2026-09-26T04:00:00Z", ny)).toEqual({ dueDate: "2026-09-26", dueTime: "00:00" }) // midnight
    expect(canvasDueToLocal("2026-09-26T03:59:59Z", ny)).toEqual({ dueDate: "2026-09-25", dueTime: "23:59" }) // just before
    // Daylight saving ends Nov 1, 2026 at 06:00 UTC: before it is EDT (-4), after it EST (-5).
    expect(canvasDueToLocal("2026-11-01T05:30:00Z", ny)).toEqual({ dueDate: "2026-11-01", dueTime: "01:30" })
    expect(canvasDueToLocal("2026-11-01T07:30:00Z", ny)).toEqual({ dueDate: "2026-11-01", dueTime: "02:30" })
    expect(canvasDueToLocal("2026-09-26T03:59:00Z", "Europe/Berlin")).toEqual({ dueDate: "2026-09-26", dueTime: "05:59" })
    // An assignment with only optional fields missing still maps; only the due date is empty.
    expect(canvasAssignmentToLms({ id: 5, name: "Bare" }, "215", { baseUrl: BASE, timeZone: ny })).toMatchObject({
      title: "Bare",
      description: null,
      dueDate: null,
      dueTime: null,
      url: null,
      submissionStatus: "unknown",
    })
  })
})
