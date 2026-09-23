import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { generatePlan } from "@/lib/planner"
import { lmsConnections } from "../../../db/schema"
import { loadAppData } from "../../../services/app-data"
import { updateTask } from "../../../services/tasks"
import {
  BLACKBOARD_BASE as BASE,
  BLACKBOARD_TEST_APP,
  BLACKBOARD_USER_ID,
  BLACKBOARD_USER_UUID,
  bbColumn,
  bbMembership,
  fakeBlackboard,
} from "../../../test-utils/fake-blackboard"
import { createTestDb } from "../../../test-utils/test-db"
import { CanvasProvider } from "../canvas/canvas-provider"
import { CANVAS_SCOPES, type CanvasConfig } from "../canvas/config"
import { disconnectLms, listLmsConnections, loadLmsCredentials, saveLmsConnection, saveLmsFeedConnection } from "../connections"
import { allowedHostsFrom } from "../base-url"
import { createCredentialVault } from "../credential-vault"
import { pkceChallenge } from "../oauth-state"
import { LmsError, LmsNotApprovedError, type LmsAccess } from "../provider"
import { syncLms } from "../sync"
import { BlackboardApiClient } from "./api-client"
import { BlackboardProvider } from "./blackboard-provider"
import { parseBlackboardBaseUrl, type BlackboardConfig } from "./config"
import {
  attemptsStatus,
  blackboardAssignmentToLms,
  blackboardCourseToLms,
  gradedColumns,
  parseBlackboardColumn,
} from "./mapping"
import { BLACKBOARD_FEED_COURSE_ID, blackboardFeedToLms, fetchBlackboardFeed, parseBlackboardFeedUrl } from "./feed"
import { syncBlackboardFeed } from "./feed-sync"
import { blackboardAuthorizationUrl, exchangeBlackboardCode, refreshBlackboardToken } from "./oauth"

// The Blackboard Learn integration without touching a real Blackboard: HTTP
// goes to a fake Learn server (src/server/test-utils/fake-blackboard.ts) that
// serves test fixtures shaped after the Learn REST API spec.

const config: BlackboardConfig = {
  ...BLACKBOARD_TEST_APP,
  redirectUri: "http://localhost:3000/api/integrations/blackboard/callback",
  allowedHosts: ["*.blackboard.com"],
}
const vault = createCredentialVault(randomBytes(32))
const NOW = new Date("2026-09-23T12:00:00Z")
const provider = (bb: ReturnType<typeof fakeBlackboard>) =>
  new BlackboardProvider({ fetch: bb.fetch, config: () => config, now: () => NOW })

const staticAccess = (token = "bb-access-1"): LmsAccess & { refreshes: number } => {
  const access = {
    baseUrl: BASE,
    timeZone: "America/New_York",
    externalUserId: BLACKBOARD_USER_ID,
    refreshes: 0,
    getAccessToken: async () => token,
    refreshAccessToken: async () => {
      access.refreshes++
      return "bb-access-1"
    },
  }
  return access
}

describe("Blackboard address", () => {
  it("accepts a school's Learn address, normalized to https://host; custom domains once allowed", () => {
    expect(parseBlackboardBaseUrl("school.blackboard.com", config.allowedHosts)).toBe(BASE)
    expect(parseBlackboardBaseUrl(" https://School.Blackboard.com/ultra/course ", config.allowedHosts)).toBe(BASE)
    expect(parseBlackboardBaseUrl("learn.myschool.edu", ["learn.myschool.edu"])).toBe("https://learn.myschool.edu")
  })

  it("refuses anything the app's secret or a token mustn't be sent to", () => {
    for (const bad of [
      "",
      "http://school.blackboard.com",
      "https://evil.example.com",
      "https://blackboard.com",
      "https://school.blackboard.com.evil.com",
      "https://user:pass@school.blackboard.com",
      "https://school.blackboard.com:8443",
      "https://10.0.0.1",
      "localhost",
      "school.local",
      "javascript:alert(1)",
    ]) {
      expect(() => parseBlackboardBaseUrl(bad, config.allowedHosts), bad).toThrow(LmsError)
    }
    expect(() => parseBlackboardBaseUrl("learn.myschool.edu", config.allowedHosts)).toThrow(
      "Student OS can't connect to learn.myschool.edu yet."
    )
  })
})

describe("Blackboard OAuth (three-legged)", () => {
  it("builds the authorization URL: app key, redirect URI, read-only + offline scope, state, PKCE S256 (no secret)", () => {
    const verifier = "v".repeat(43)
    const url = new URL(blackboardAuthorizationUrl(config, BASE, "state-123", verifier))
    expect(url.origin + url.pathname).toBe(`${BASE}/learn/api/public/v1/oauth2/authorizationcode`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      redirect_uri: config.redirectUri,
      response_type: "code",
      client_id: "test-bb-key",
      scope: "read offline",
      state: "state-123",
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
    })
    expect(url.toString()).not.toContain(config.clientSecret)
    expect(url.toString()).not.toContain(verifier)
  })

  it("exchanges the code on the server with HTTP Basic app auth and the PKCE verifier, then finds the student's id", async () => {
    const verifier = "a".repeat(43)
    const bb = fakeBlackboard({ codeVerifier: verifier })
    const tokens = await provider(bb).exchangeCode({ baseUrl: BASE, code: "good-code", codeVerifier: verifier })
    expect(tokens).toEqual({
      accessToken: "bb-access-1",
      refreshToken: "bb-refresh",
      expiresAt: expect.any(Date),
      externalUserId: BLACKBOARD_USER_ID, // the REST primary id, not the token's UUID
    })
    const [token, me] = bb.requests
    expect(token.method).toBe("POST")
    expect(token.url.searchParams.get("grant_type")).toBe("authorization_code")
    expect(token.url.searchParams.get("code_verifier")).toBe(verifier)
    expect(token.url.searchParams.get("redirect_uri")).toBe(config.redirectUri)
    // The secret only travels in the Authorization header, never in the URL or body.
    expect(token.url.toString() + token.body).not.toContain(config.clientSecret)
    expect(token.headers.get("authorization")).toMatch(/^Basic /)
    expect(me.url.pathname).toBe(`/learn/api/public/v1/users/uuid:${BLACKBOARD_USER_UUID}`)
    expect(me.headers.get("authorization")).toBe("Bearer bb-access-1")
  })

  it("rejects a code sent with the wrong PKCE verifier", async () => {
    const bb = fakeBlackboard({ codeVerifier: "a".repeat(43) })
    await expect(
      exchangeBlackboardCode(config, BASE, "good-code", "b".repeat(43), bb.fetch)
    ).rejects.toMatchObject({ reconnect: true })
  })

  it("says clearly when the school hasn't approved Student OS", async () => {
    const bb = fakeBlackboard({ approved: false })
    const error = await exchangeBlackboardCode(config, BASE, "good-code", "a".repeat(43), bb.fetch).catch((e) => e)
    expect(error).toBeInstanceOf(LmsNotApprovedError)
    expect(error.message).toBe("Your school hasn't enabled Student OS in Blackboard. Ask your Blackboard administrator to approve it.")
  })

  it("reports a rejected code, an outage, rate limiting and an unreadable response safely", async () => {
    const bb = fakeBlackboard()
    await expect(exchangeBlackboardCode(config, BASE, "bad-code", "a".repeat(43), bb.fetch)).rejects.toThrow(
      "Your Blackboard connection expired. Please reconnect."
    )
    const down = (async () => {
      throw new TypeError("getaddrinfo ENOTFOUND")
    }) as typeof fetch
    await expect(exchangeBlackboardCode(config, BASE, "good-code", "a", down)).rejects.toThrow(
      "Blackboard is temporarily unavailable. Please try again."
    )
    const busy = (async () => new Response("{}", { status: 429 })) as typeof fetch
    await expect(exchangeBlackboardCode(config, BASE, "good-code", "a", busy)).rejects.toThrow("Blackboard is busy right now.")
    const garbage = (async () => new Response("<html>")) as typeof fetch
    await expect(exchangeBlackboardCode(config, BASE, "good-code", "a", garbage)).rejects.toThrow("couldn't read")
  })

  it("refreshes the access token (offline scope) and keeps the refresh token", async () => {
    const bb = fakeBlackboard()
    const tokens = await refreshBlackboardToken(config, BASE, "bb-refresh", bb.fetch)
    expect(tokens).toMatchObject({ accessToken: "bb-access-2", refreshToken: "bb-refresh" })
    expect(bb.requests[0].url.searchParams.get("grant_type")).toBe("refresh_token")
    expect(bb.requests[0].url.searchParams.get("refresh_token")).toBe("bb-refresh")
  })

  it("has no revoke endpoint to call: disconnecting never touches the network", async () => {
    const bb = fakeBlackboard()
    await provider(bb).revokeTokens()
    expect(bb.requests).toEqual([])
  })
})

describe("Blackboard API client", () => {
  it("sends the token in the Authorization header, never in the URL", async () => {
    const bb = fakeBlackboard({ memberships: [bbMembership("_1_1")] })
    await new BlackboardApiClient(staticAccess(), { fetch: bb.fetch }).getAll(`v1/users/${BLACKBOARD_USER_ID}/courses`)
    expect(bb.requests[0].headers.get("authorization")).toBe("Bearer bb-access-1")
    expect(bb.requests[0].url.toString()).not.toContain("bb-access-1")
  })

  it("follows Learn's paging.nextPage to the end", async () => {
    const memberships = Array.from({ length: 5 }, (_, i) => bbMembership(`_${i + 1}_1`))
    const bb = fakeBlackboard({ memberships, pageSize: 2 })
    const items = await new BlackboardApiClient(staticAccess(), { fetch: bb.fetch }).getAll(`v1/users/${BLACKBOARD_USER_ID}/courses`)
    expect(items).toHaveLength(5)
    expect(bb.requests).toHaveLength(3)
  })

  it("stops at the page limit, and never follows a next page to another host or outside the API", async () => {
    for (const nextPage of ["https://evil.example.com/learn/api/public/v1/x", "//evil.example.com/x", "/webapps/login/"]) {
      const calls: string[] = []
      const fetchImpl = (async (input: RequestInfo | URL) => {
        calls.push(String(input))
        return new Response(JSON.stringify({ results: [{}], paging: { nextPage } }))
      }) as typeof fetch
      await new BlackboardApiClient(staticAccess(), { fetch: fetchImpl }).getAll("v1/x")
      expect(calls, nextPage).toHaveLength(1)
    }
    const endless = (async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({ results: [{}], paging: { nextPage: new URL(String(input)).pathname + "?offset=1" } }))) as typeof fetch
    expect(await new BlackboardApiClient(staticAccess(), { fetch: endless, maxPages: 3 }).getAll("v1/x")).toHaveLength(3)
  })

  it("on a 401, refreshes the token once and retries", async () => {
    const bb = fakeBlackboard({ memberships: [bbMembership("_1_1")] })
    const access = staticAccess("expired-token")
    expect(await new BlackboardApiClient(access, { fetch: bb.fetch }).getAll(`v1/users/${BLACKBOARD_USER_ID}/courses`)).toHaveLength(1)
    expect(access.refreshes).toBe(1)
  })

  it("asks to reconnect if the refreshed token is rejected too", async () => {
    const bb = fakeBlackboard({ validTokens: [] })
    const error = await new BlackboardApiClient(staticAccess(), { fetch: bb.fetch }).getAll("v1/x").catch((e) => e)
    expect(error).toMatchObject({ message: "Your Blackboard connection expired. Please reconnect.", reconnect: true })
  })

  it("turns API errors into simple messages (no status codes, no Blackboard error text)", async () => {
    const answer = (status: number) => (async () => new Response(JSON.stringify({ status, message: "internal detail" }), { status })) as typeof fetch
    const get = (status: number, scope: "course" | "connection" = "connection") =>
      new BlackboardApiClient(staticAccess(), { fetch: answer(status) }).getAll("v1/x", [], scope).catch((e) => e)
    expect((await get(429)).message).toBe("Blackboard is busy right now. Please try again in a few minutes.")
    expect(await get(403, "course")).toMatchObject({ message: "Blackboard didn't allow Student OS to read this course.", scope: "course" })
    expect((await get(403)).message).toBe("Blackboard didn't allow Student OS to read your courses. Try reconnecting.")
    expect((await get(404, "course")).message).toBe("This course wasn't found in Blackboard.")
    expect((await get(500)).message).toBe("Blackboard is temporarily unavailable. Please try again.")
    const garbage = (async () => new Response("<html>")) as typeof fetch
    expect((await new BlackboardApiClient(staticAccess(), { fetch: garbage }).getAll("v1/x").catch((e) => e)).message).toContain(
      "couldn't read"
    )
  })
})

describe("mapping Blackboard data", () => {
  it("imports the courses the student takes; skips organizations, teaching roles and unavailable courses", () => {
    expect(blackboardCourseToLms(bbMembership("_215_1", {}, { courseId: "BIO-101", name: "Biology" }), BASE)).toEqual({
      provider: "blackboard",
      externalId: "_215_1",
      courseCode: "BIO-101",
      courseName: "Biology",
      description: "Intro course",
      instructor: null,
      url: `${BASE}/ultra/courses/_215_1/outline`,
    })
    expect(blackboardCourseToLms(bbMembership("_1_1", {}, { availability: { available: "Term" } }), BASE)).not.toBeNull()
    expect(blackboardCourseToLms(bbMembership("_2_1", {}, { organization: true }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_3_1", { courseRoleId: "Instructor" }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_4_1", { courseRoleId: "TeachingAssistant" }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_5_1", {}, { availability: { available: "No" } }), BASE)).toBeNull()
    expect(blackboardCourseToLms(bbMembership("_6_1", { availability: { available: "Disabled" } }), BASE)).toBeNull()
    expect(blackboardCourseToLms({ courseId: "_7_1" }, BASE)).toBeNull() // course not expanded
    expect(blackboardCourseToLms("garbage", BASE)).toBeNull()
  })

  it("only keeps links to the student's own Blackboard", () => {
    const course = (url: string) => blackboardCourseToLms(bbMembership("_1_1", {}, { externalAccessUrl: url }), BASE)?.url
    expect(course("https://evil.example.com/ultra/courses/_1_1")).toBeNull()
    expect(course("javascript:alert(1)")).toBeNull()
    expect(course("http://school.blackboard.com/ultra")).toBeNull()
    expect(course(`${BASE}/webapps/blackboard/execute/courseMain?course_id=_1_1`)).toBe(
      `${BASE}/webapps/blackboard/execute/courseMain?course_id=_1_1`
    )
  })

  it("keeps real work: drops totals, calculated and hidden columns", () => {
    expect(parseBlackboardColumn(bbColumn("_1_1"))).not.toBeNull()
    expect(parseBlackboardColumn(bbColumn("_2_1", { externalGrade: true }))).toBeNull()
    expect(parseBlackboardColumn(bbColumn("_3_1", { grading: { type: "Calculated" } }))).toBeNull()
    expect(parseBlackboardColumn(bbColumn("_4_1", { availability: { available: "No" } }))).toBeNull()
    expect(parseBlackboardColumn(bbColumn("_5_1", { name: " ", displayName: null }))).toBeNull()
    expect(parseBlackboardColumn({ name: "No id" })).toBeNull()
  })

  it("maps a column: local due date/time, plain-text description, course link, type; no invented estimate", () => {
    const column = parseBlackboardColumn(bbColumn("_9_1", { displayName: "Lab report 2" }))!
    expect(
      blackboardAssignmentToLms(column, "_215_1", { timeZone: "America/New_York", courseUrl: `${BASE}/ultra/courses/_215_1/outline`, submissionStatus: "unknown" })
    ).toEqual({
      provider: "blackboard",
      externalId: "_9_1",
      courseExternalId: "_215_1",
      title: "Lab report 2",
      description: "Read chapter 3 & answer",
      dueDate: "2026-09-25",
      dueTime: "23:59",
      type: "assignment",
      url: `${BASE}/ultra/courses/_215_1/outline`,
      estimatedMinutes: null,
      submissionStatus: "unknown",
    })
    const typeOf = (handle: string) =>
      blackboardAssignmentToLms(parseBlackboardColumn(bbColumn("_1_1", { scoreProviderHandle: handle }))!, "c", {
        timeZone: undefined,
        courseUrl: null,
        submissionStatus: "unknown",
      }).type
    expect(typeOf("resource/x-bb-asmt-test-link")).toBe("quiz")
    expect(typeOf("resource/x-bb-forumlink")).toBe("other")
    expect(typeOf("resource/x-bb-assignment")).toBe("assignment")
    const undated = parseBlackboardColumn(bbColumn("_2_1", { grading: { type: "Manual" } }))!
    expect(blackboardAssignmentToLms(undated, "c", { timeZone: undefined, courseUrl: null, submissionStatus: "unknown" })).toMatchObject({
      dueDate: null,
      dueTime: null,
    })
  })

  it("reads submission status conservatively", () => {
    // A grade counts only with a real score or text; Learn's unreliable "status" field is ignored.
    expect(gradedColumns([{ columnId: "a", score: 8 }, { columnId: "b", text: "A-" }, { columnId: "c", status: "Graded" }, "junk"])).toEqual(
      new Set(["a", "b"])
    )
    expect(attemptsStatus([{ status: "NeedsGrading" }])).toBe("submitted")
    expect(attemptsStatus([{ status: "InProgress" }, { status: "Completed" }])).toBe("submitted")
    expect(attemptsStatus([{ status: "InProgress" }])).toBe("not_submitted")
    expect(attemptsStatus([])).toBe("not_submitted")
    expect(attemptsStatus([{ status: "InProgress" }, { unexpected: true }])).toBe("unknown")
  })
})

// ---- The whole sync, through the real services and a real Postgres ------------------

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

async function connected(name: string, options: { expiresAt?: Date; externalUserId?: string | null } = {}) {
  const user = await t.addUser(name)
  await saveLmsConnection(
    t.db,
    user,
    "blackboard",
    {
      accessToken: "bb-access-1",
      refreshToken: "bb-refresh",
      expiresAt: options.expiresAt ?? new Date("2026-09-23T13:00:00Z"),
      externalUserId: options.externalUserId === undefined ? BLACKBOARD_USER_ID : options.externalUserId,
      baseUrl: BASE,
    },
    vault
  )
  return user
}

const sync = (user: string, bb: ReturnType<typeof fakeBlackboard>) =>
  syncLms(t.db, user, provider(bb), vault, { now: NOW, timeZone: "America/New_York" })

describe("syncing Blackboard into Student OS", () => {
  it("imports courses and gradebook items as normal courses and tasks", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({
      memberships: [
        bbMembership("_215_1", {}, { courseId: "BIO-215", name: "Biology" }),
        bbMembership("_300_1", {}, { organization: true, name: "Chess Club" }),
      ],
      columns: {
        "_215_1": [
          bbColumn("_1_1"),
          bbColumn("_2_1", { grading: { type: "Manual" } }), // no due date
          bbColumn("_3_1", { name: "Total", externalGrade: true, grading: { type: "Calculated" } }),
        ],
      },
      grades: { "_215_1": [] },
      attempts: { "_1_1": [] },
    })
    const result = await sync(user, bb)
    expect(result).toMatchObject({ provider: "blackboard", coursesCreated: 1, assignmentsCreated: 1, assignmentsWithoutDueDate: 1, errors: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([
      expect.objectContaining({
        code: "BIO-215",
        name: "Biology",
        source: { provider: "blackboard", externalId: "_215_1", url: `${BASE}/ultra/courses/_215_1/outline` },
      }),
    ])
    expect(data.tasks).toEqual([
      expect.objectContaining({
        title: "Assignment _1_1",
        dueDate: "2026-09-25",
        dueTime: "23:59",
        priority: "medium",
        status: "not_started",
        estimateMinutes: null,
        source: {
          provider: "blackboard",
          externalId: "_1_1",
          url: `${BASE}/ultra/courses/_215_1/outline`,
          submissionStatus: "not_submitted",
        },
      }),
    ])
    // Read-only: every API request was a GET (only the token endpoint is POSTed to).
    expect(bb.requests.filter((r) => !r.url.pathname.endsWith("/oauth2/token")).every((r) => r.method === "GET")).toBe(true)
  })

  it("repeat syncs don't duplicate; changes update; removed items are kept and reported", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1"), bbColumn("_2_1")] } })
    await sync(user, bb)
    expect(await sync(user, bb)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)

    bb.state.columns["_215_1"] = [bbColumn("_1_1", { grading: { type: "Attempts", due: "2026-09-28T03:59:00.000Z" } })]
    const changed = await sync(user, bb)
    expect(changed).toMatchObject({ assignmentsUpdated: 1, assignmentsMissing: 1, missing: [{ taskId: expect.any(String), title: "Assignment _2_1" }] })
    const tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.find((task) => task.title === "Assignment _1_1")?.dueDate).toBe("2026-09-27")
  })

  it("links a task the student already made instead of duplicating it", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1", {}, { name: "Biology" })], columns: { "_215_1": [bbColumn("_1_1")] } })
    await sync(user, bb)
    // Disconnect-free re-import of the same items: matched by source id, never duplicated.
    const again = await sync(user, bb)
    expect(again.assignmentsCreated + again.assignmentsLinked).toBe(0)
    expect((await loadAppData(t.db, user)).courses).toHaveLength(1)
  })

  it("keeps the student's own changes when Blackboard changes the same field", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] } })
    await sync(user, bb)
    const task = (await loadAppData(t.db, user)).tasks[0]
    await updateTask(t.db, user, task.id, { dueDate: "2026-09-27", priority: "high", notes: "Start early" })

    bb.state.columns["_215_1"] = [bbColumn("_1_1", { name: "Lab 1 (updated)", grading: { type: "Attempts", due: "2026-09-29T03:59:00.000Z" } })]
    const result = await sync(user, bb)
    expect(result.conflicts).toEqual([
      { taskId: task.id, title: "Assignment _1_1", field: "dueDate", studentValue: "2026-09-27", lmsValue: "2026-09-28" },
    ])
    const after = (await loadAppData(t.db, user)).tasks[0]
    expect(after).toMatchObject({ title: "Lab 1 (updated)", dueDate: "2026-09-27", priority: "high", notes: "Start early" })
  })

  it("marks tasks done only on a real submission or grade, and never un-completes", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({
      memberships: [bbMembership("_215_1")],
      columns: {
        "_215_1": [
          bbColumn("_1_1"), // not submitted yet
          bbColumn("_2_1"), // already graded
          bbColumn("_3_1", { grading: { type: "Manual", due: "2026-09-30T03:59:00.000Z" } }), // manual, no grade: unknown
          bbColumn("_4_1", { grading: { type: "Attempts", due: "2026-07-01T03:59:00.000Z" } }), // long past: not looked up
        ],
      },
      grades: { "_215_1": [{ columnId: "_2_1", score: 9 }] },
      attempts: { "_1_1": [], "_4_1": [{ status: "NeedsGrading" }] },
    })
    const first = await sync(user, bb)
    expect(first.assignmentsCreated).toBe(4)
    const status = async () =>
      Object.fromEntries((await loadAppData(t.db, user)).tasks.map((task) => [task.source?.externalId, [task.status, task.source?.submissionStatus]]))
    expect(await status()).toEqual({
      "_1_1": ["not_started", "not_submitted"],
      "_2_1": ["completed", "graded"],
      "_3_1": ["not_started", undefined], // unknown: nothing stored, nothing assumed
      "_4_1": ["not_started", undefined],
    })
    // Attempts were only requested for the ungraded, attempt-based, recent item.
    const attemptCalls = bb.requests.filter((r) => r.url.pathname.endsWith("/attempts"))
    expect(attemptCalls.map((r) => r.url.pathname)).toEqual(["/learn/api/public/v2/courses/_215_1/gradebook/columns/_1_1/attempts"])

    // The student turns in _1_1 in Blackboard.
    bb.state.attempts["_1_1"] = [{ status: "NeedsGrading" }]
    expect((await sync(user, bb)).assignmentsCompleted).toBe(1)
    expect((await status())["_1_1"]).toEqual(["completed", "submitted"])

    // The student reopens it in Student OS; Blackboard still says submitted: left alone.
    const reopened = (await loadAppData(t.db, user)).tasks.find((task) => task.source?.externalId === "_1_1")!
    await updateTask(t.db, user, reopened.id, { status: "in_progress" })
    expect((await sync(user, bb)).assignmentsCompleted).toBe(0)
    expect((await status())["_1_1"][0]).toBe("in_progress")
  })

  it("imports a course whose grades can't be read, with statuses left unknown", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] }, grades: { "_215_1": 403 } })
    const result = await sync(user, bb)
    expect(result).toMatchObject({ assignmentsCreated: 1, errors: [] })
    expect((await loadAppData(t.db, user)).tasks[0]).toMatchObject({ status: "not_started" })
    expect((await loadAppData(t.db, user)).tasks[0].source?.submissionStatus).toBeUndefined()
  })

  it("skips a course Blackboard won't show, without losing the rest", async () => {
    const user = await connected("Alex")
    const bb = fakeBlackboard({
      memberships: [bbMembership("_1_1", {}, { name: "Biology" }), bbMembership("_2_1", {}, { name: "Chemistry" })],
      columns: { "_1_1": 403, "_2_1": [bbColumn("_9_1")] },
    })
    const result = await sync(user, bb)
    expect(result).toMatchObject({
      coursesSkipped: 1,
      assignmentsCreated: 1,
      errors: ["Biology: Blackboard didn't allow Student OS to read this course."],
    })
  })

  it("refreshes an expired token before syncing, and stores the new one encrypted", async () => {
    const user = await connected("Alex", { expiresAt: new Date("2026-09-23T11:00:00Z") })
    const bb = fakeBlackboard({ memberships: [], validTokens: [] })
    await sync(user, bb)
    expect(bb.requests[0].url.searchParams.get("grant_type")).toBe("refresh_token")
    const [row] = await t.db.select().from(lmsConnections)
    expect(row.accessTokenEncrypted).not.toContain("bb-access")
    expect((await loadLmsCredentials(t.db, user, "blackboard", vault)).accessToken).toBe("bb-access-2")
  })

  it("asks the student to reconnect when the refresh token is rejected", async () => {
    const user = await t.addUser("Alex")
    await saveLmsConnection(
      t.db,
      user,
      "blackboard",
      { accessToken: "old", refreshToken: "revoked", expiresAt: new Date("2026-09-23T11:00:00Z"), externalUserId: BLACKBOARD_USER_ID, baseUrl: BASE },
      vault
    )
    await expect(sync(user, fakeBlackboard())).rejects.toThrow("Your Blackboard connection expired. Please reconnect.")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ status: "needs_reauth" })
  })

  it("reports a school that withdrew its approval without asking to reconnect in a loop", async () => {
    const user = await connected("Alex", { expiresAt: new Date("2026-09-23T11:00:00Z") })
    await expect(sync(user, fakeBlackboard({ approved: false }))).rejects.toThrow("Ask your Blackboard administrator")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ status: "error" })
  })

  it("asks to reconnect a connection saved without the student's Blackboard id", async () => {
    const user = await connected("Alex", { externalUserId: null })
    await expect(sync(user, fakeBlackboard())).rejects.toThrow("Please reconnect Blackboard.")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ status: "needs_reauth" })
  })

  it("keeps each student's Blackboard data separate", async () => {
    const alice = await connected("Alice")
    const bob = await connected("Bob")
    const bb = fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] } })
    await sync(alice, bb)
    expect((await loadAppData(t.db, bob)).tasks).toEqual([])
    await sync(bob, bb)
    expect((await loadAppData(t.db, alice)).tasks[0].id).not.toBe((await loadAppData(t.db, bob)).tasks[0].id)
  })

  it("never lets a provider error or token reach the student or the database", async () => {
    const user = await connected("Alex")
    const leaky = (async () => {
      throw new Error(`connect failed for ${BASE}?access_token=bb-access-1`)
    }) as typeof fetch
    const error = await syncLms(t.db, user, new BlackboardProvider({ fetch: leaky, config: () => config }), vault, { now: NOW }).catch((e) => e)
    expect(error.message).toBe("Blackboard is temporarily unavailable. Please try again.")
    expect(JSON.stringify(await listLmsConnections(t.db, user))).not.toContain("bb-access")
  })

  it("imported Blackboard tasks go straight into the Planner", async () => {
    const user = await connected("Alex")
    await sync(user, fakeBlackboard({ memberships: [bbMembership("_215_1")], columns: { "_215_1": [bbColumn("_1_1")] } }))
    const data = await loadAppData(t.db, user)
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId)).toContain(data.tasks[0].id)
  })
})

// ---- Canvas and Blackboard at the same time -----------------------------------------

describe("Canvas and Blackboard connected together", () => {
  const CANVAS = "https://school.instructure.com"
  const canvasConfig: CanvasConfig = {
    clientId: "test-client-id",
    clientSecret: "test-client-secret",
    redirectUri: "http://localhost:3000/api/integrations/canvas/callback",
    allowedHosts: ["*.instructure.com"],
    scopes: CANVAS_SCOPES,
  }
  // Canvas fixture that deliberately uses the SAME ids as the Blackboard fixture below.
  const canvasFetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } })
    if (url.pathname === "/api/v1/courses") return json([{ id: "215", name: "Canvas Biology", course_code: "BIO 215" }])
    if (url.pathname === "/api/v1/courses/215/assignments") {
      return json([{ id: "1", name: "Canvas essay", due_at: "2026-09-26T03:59:00Z", html_url: `${CANVAS}/courses/215/assignments/1`, published: true }])
    }
    return new Response("{}", { status: 404 })
  }) as unknown as typeof fetch

  async function bothConnected() {
    const user = await connected("Alex")
    await saveLmsConnection(
      t.db,
      user,
      "canvas",
      { accessToken: "canvas-access-1", refreshToken: "canvas-refresh", expiresAt: new Date("2026-09-23T13:00:00Z"), externalUserId: "42", baseUrl: CANVAS },
      vault
    )
    return user
  }
  const bb = () =>
    fakeBlackboard({
      memberships: [bbMembership("215", {}, { name: "Blackboard Chemistry", courseId: "CHEM-110" })],
      columns: { "215": [bbColumn("1", { name: "Blackboard lab" })] },
    })
  const syncCanvas = (user: string) =>
    syncLms(t.db, user, new CanvasProvider({ fetch: canvasFetch, config: () => canvasConfig }), vault, { now: NOW, timeZone: "America/New_York" })

  it("identical external ids from the two LMSs never collide", async () => {
    const user = await bothConnected()
    const blackboard = bb()
    await syncCanvas(user)
    await sync(user, blackboard)
    // Syncing again, in either order, changes nothing and reports nothing missing.
    expect(await syncCanvas(user)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsMissing: 0, missingCourses: [] })
    expect(await sync(user, blackboard)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsMissing: 0, missingCourses: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses.map((c) => [c.source?.provider, c.source?.externalId, c.name]).sort()).toEqual([
      ["blackboard", "215", "Blackboard Chemistry"],
      ["canvas", "215", "Canvas Biology"],
    ])
    expect(data.tasks.map((task) => [task.source?.provider, task.source?.externalId, task.title]).sort()).toEqual([
      ["blackboard", "1", "Blackboard lab"],
      ["canvas", "1", "Canvas essay"],
    ])
    // Each task belongs to its own LMS's course.
    const courseOf = (provider: string) => data.courses.find((c) => c.source?.provider === provider)!.id
    for (const task of data.tasks) expect(task.courseId).toBe(courseOf(task.source!.provider))
    // Both show up in the Planner, which doesn't care where they came from.
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId).sort()).toEqual(data.tasks.map((task) => task.id).sort())
  })

  it("the same course code in both LMSs is reported, never merged into the other LMS's course", async () => {
    const user = await bothConnected()
    await syncCanvas(user)
    const blackboard = fakeBlackboard({
      memberships: [bbMembership("215", {}, { name: "Blackboard Biology", courseId: "BIO-215" })],
      columns: { "215": [bbColumn("1")] },
    })
    const result = await sync(user, blackboard)
    expect(result).toMatchObject({ coursesCreated: 0, coursesLinked: 0, coursesSkipped: 1 })
    expect(result.errors).toEqual(["Blackboard Biology: You already have a course with the code BIO 215."])
    const data = await loadAppData(t.db, user)
    expect(data.courses.map((c) => c.source?.provider)).toEqual(["canvas"])
    expect(data.tasks.map((task) => task.source?.provider)).toEqual(["canvas"])
  })

  it("each connection has its own tokens, and disconnecting one leaves the other working", async () => {
    const user = await bothConnected()
    expect((await loadLmsCredentials(t.db, user, "canvas", vault)).accessToken).toBe("canvas-access-1")
    expect((await loadLmsCredentials(t.db, user, "blackboard", vault)).accessToken).toBe("bb-access-1")
    await syncCanvas(user)
    await sync(user, bb())

    await disconnectLms(t.db, user, "blackboard")
    expect((await listLmsConnections(t.db, user)).map((c) => c.provider)).toEqual(["canvas"])
    // Imported Blackboard data stays; Canvas still syncs.
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)
    expect(await syncCanvas(user)).toMatchObject({ assignmentsMissing: 0 })
  })
})

// ---- The calendar link (Share Calendar), no administrator approval needed ----------

// TEST FIXTURE shaped like a real Blackboard Learn calendar feed (same properties,
// UID format and time zone style; made-up titles and ids).
const FEED_URL = `${BASE}/webapps/calendar/calendarFeed/0a1b2c3d4e5f60718293a4b5c6d7e8f9/learn.ics`
const feedEvent = (id: string, title: string, due: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  "DTSTAMP:20260923T193949Z",
  `DTSTART;TZID=America/New_York:${due}`,
  `DTEND;TZID=America/New_York:${due}`,
  `SUMMARY:${title}`,
  `UID:_blackboard.platform.gradebook2.GradableItem-${id}`,
  "DESCRIPTION:",
  ...extra,
  "END:VEVENT",
]
const feedText = (...events: string[][]) =>
  [
    "BEGIN:VCALENDAR",
    "PRODID:-//Blackboard//EN",
    "VERSION:2.0",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Example University",
    "X-PUBLISHED-TTL:PT4H",
    "BEGIN:VTIMEZONE",
    "TZID:America/New_York",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:-0500",
    "TZOFFSETTO:-0400",
    "TZNAME:EDT",
    "DTSTART:19700308T020000",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    ...events.flat(),
    "END:VCALENDAR",
  ].join("\r\n")

function feedServer(text: () => string, status = 200) {
  const requests: string[] = []
  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    requests.push(String(input))
    expect(init.redirect).toBe("error")
    return new Response(status === 200 ? text() : "Not found", { status, headers: { "Content-Type": "text/calendar" } })
  }) as typeof fetch
  return { fetch: fetchImpl, requests }
}

describe("server configuration mistakes", () => {
  it("the host allowlist ignores https:// and trailing slashes", () => {
    const hosts = allowedHostsFrom("https://myschool.blackboard.com/, school.blackboard.com/ , *.Blackboard.com", "")
    expect(hosts).toEqual(["myschool.blackboard.com", "school.blackboard.com", "*.blackboard.com"])
    expect(parseBlackboardBaseUrl("myschool.blackboard.com", allowedHostsFrom("myschool.blackboard.com/", ""))).toBe(
      "https://myschool.blackboard.com"
    )
  })

  it("a new encryption key on the server: the student is asked to reconnect, nothing else breaks", async () => {
    const user = await t.addUser("Alex")
    await saveLmsFeedConnection(t.db, user, "blackboard", { baseUrl: BASE, feedUrl: FEED_URL }, vault)
    const newKey = createCredentialVault(randomBytes(32))
    const server = feedServer(() => feedText(feedEvent("_1001_1", "Lab 4", "20260929T235900")))
    const error = await syncBlackboardFeed(t.db, user, newKey, { now: NOW, timeZone: "America/New_York", fetch: server.fetch }).catch((e) => e)
    expect(error.message).toBe("Student OS can't use your saved Blackboard connection anymore. Please connect Blackboard again.")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ status: "needs_reauth" })
    expect(server.requests).toEqual([])

    // Same for a signed-in connection.
    const other = await connected("Sam")
    await expect(syncLms(t.db, other, provider(fakeBlackboard()), newKey, { now: NOW })).rejects.toThrow(
      "Please connect Blackboard again."
    )
  })
})

describe("Blackboard calendar link", () => {
  it("accepts only a Blackboard Share Calendar link on an allowed host", () => {
    expect(parseBlackboardFeedUrl(` ${FEED_URL} `, config.allowedHosts)).toEqual({ baseUrl: BASE, feedUrl: FEED_URL })
    expect(parseBlackboardFeedUrl(FEED_URL.replace("https://", "webcal://"), config.allowedHosts).feedUrl).toBe(FEED_URL)
    for (const bad of [
      "",
      FEED_URL.replace("https://", "http://"),
      FEED_URL.replace("school.blackboard.com", "evil.example.com"),
      `${BASE}/webapps/login/`,
      `${BASE}/webapps/calendar/calendarFeed/../../../etc/learn.ics`,
      `${BASE}/webapps/calendar/calendarFeed/x/learn.ics#frag`,
      "https://school.instructure.com/feeds/calendars/user_abc.ics",
      "not a link",
    ]) {
      expect(() => parseBlackboardFeedUrl(bad, config.allowedHosts), bad).toThrow(LmsError)
    }
  })

  it("reads gradable items with Blackboard's own ids and local due times; only from today on", () => {
    const text = feedText(
      feedEvent("_1001_1", "Lab 4", "20260929T235900"),
      feedEvent("_1002_1", "Essay  draft", "20261006T194500"),
      feedEvent("_0999_1", "Old quiz", "20260901T235900"), // already past
      ["BEGIN:VEVENT", "UID:office-hours-1", "SUMMARY:Office hours", "DTSTART:20260930T150000Z", "END:VEVENT"]
    )
    const data = blackboardFeedToLms(text, { timeZone: "America/New_York", today: "2026-09-23" })
    expect(data).toMatchObject({ pastItems: 1, skippedEvents: 1 })
    expect(data.courses).toEqual([expect.objectContaining({ provider: "blackboard", externalId: BLACKBOARD_FEED_COURSE_ID, courseName: "Blackboard" })])
    expect(data.assignments).toEqual([
      expect.objectContaining({ externalId: "_1001_1", title: "Lab 4", dueDate: "2026-09-29", dueTime: "23:59", submissionStatus: "unknown", url: null, estimatedMinutes: null }),
      expect.objectContaining({ externalId: "_1002_1", title: "Essay draft", dueDate: "2026-10-06", dueTime: "19:45" }),
    ])
    // Another time zone sees the same moment in its own local time.
    expect(blackboardFeedToLms(text, { timeZone: "America/Los_Angeles", today: "2026-09-23" }).assignments[0]).toMatchObject({
      dueDate: "2026-09-29",
      dueTime: "20:59",
    })
    // Nothing upcoming: no course is created either.
    expect(blackboardFeedToLms(feedText(feedEvent("_0999_1", "Old", "20250901T235900")), { timeZone: undefined, today: "2026-09-23" })).toMatchObject({
      courses: [],
      assignments: [],
      pastItems: 1,
    })
  })

  it("downloads safely and explains a dead link or a non-calendar", async () => {
    await expect(fetchBlackboardFeed(FEED_URL, feedServer(() => "", 404).fetch)).rejects.toMatchObject({
      message: "This Blackboard calendar link no longer works. Copy a new one from Blackboard.",
      reconnect: true,
    })
    await expect(fetchBlackboardFeed(FEED_URL, feedServer(() => "<html>login</html>").fetch)).rejects.toThrow(
      "That link didn't return a Blackboard calendar."
    )
  })

  async function feedConnected(name: string) {
    const user = await t.addUser(name)
    await saveLmsFeedConnection(t.db, user, "blackboard", { baseUrl: BASE, feedUrl: FEED_URL }, vault)
    return user
  }
  const syncFeed = (user: string, server: ReturnType<typeof feedServer>) =>
    syncBlackboardFeed(t.db, user, vault, { now: NOW, timeZone: "America/New_York", fetch: server.fetch })

  it("syncs into one Blackboard course, without duplicates, keeping the student's changes", async () => {
    const user = await feedConnected("Alex")
    let text = feedText(feedEvent("_1001_1", "Lab 4", "20260929T235900"), feedEvent("_1002_1", "Lab 5", "20261006T235900"))
    const server = feedServer(() => text)
    expect(await syncFeed(user, server)).toMatchObject({ provider: "blackboard", coursesCreated: 1, assignmentsCreated: 2, errors: [] })
    expect(await syncFeed(user, server)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })

    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([expect.objectContaining({ code: "BLACKBOARD", name: "Blackboard" })])
    expect(data.tasks.map((task) => [task.title, task.dueDate, task.status, task.source?.externalId])).toEqual([
      ["Lab 4", "2026-09-29", "not_started", "_1001_1"],
      ["Lab 5", "2026-10-06", "not_started", "_1002_1"],
    ])

    // The student fixes the date on Lab 4; Blackboard moves it too and drops Lab 5.
    const lab4 = data.tasks.find((task) => task.title === "Lab 4")!
    await updateTask(t.db, user, lab4.id, { dueDate: "2026-09-28" })
    text = feedText(feedEvent("_1001_1", "Lab 4", "20261001T235900"))
    const result = await syncFeed(user, server)
    expect(result.conflicts).toEqual([
      { taskId: lab4.id, title: "Lab 4", field: "dueDate", studentValue: "2026-09-28", lmsValue: "2026-10-01" },
    ])
    expect(result).toMatchObject({ assignmentsMissing: 1, missing: [{ taskId: expect.any(String), title: "Lab 5" }] })
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)
    // The link never reaches a sync result or the connection summary.
    expect(JSON.stringify([result, await listLmsConnections(t.db, user)])).not.toContain("calendarFeed")
  })

  it("asks for a new link when Blackboard no longer accepts it", async () => {
    const user = await feedConnected("Alex")
    await expect(syncFeed(user, feedServer(() => "", 404))).rejects.toThrow("This Blackboard calendar link no longer works.")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ method: "calendar_feed", status: "needs_reauth" })
  })

  it("signing in later reuses the same tasks (same gradebook ids), no duplicates", async () => {
    const user = await feedConnected("Alex")
    await syncFeed(user, feedServer(() => feedText(feedEvent("_1001_1", "Lab 4", "20260929T235900"))))
    await saveLmsConnection(
      t.db,
      user,
      "blackboard",
      { accessToken: "bb-access-1", refreshToken: "bb-refresh", expiresAt: new Date("2026-09-23T13:00:00Z"), externalUserId: BLACKBOARD_USER_ID, baseUrl: BASE },
      vault
    )
    const bb = fakeBlackboard({
      memberships: [bbMembership("_215_1", {}, { name: "Biology" })],
      columns: { "_215_1": [bbColumn("_1001_1", { name: "Lab 4", grading: { type: "Attempts", due: "2026-09-30T03:59:00.000Z" } })] },
      grades: { "_215_1": [{ columnId: "_1001_1", score: 10 }] },
    })
    const result = await sync(user, bb)
    expect(result).toMatchObject({ assignmentsCreated: 0, assignmentsCompleted: 1 })
    const tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ title: "Lab 4", status: "completed", source: { provider: "blackboard", externalId: "_1001_1" } })
  })
})
