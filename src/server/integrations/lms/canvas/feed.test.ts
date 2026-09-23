import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { generatePlan } from "@/lib/planner"
import { lmsConnections } from "../../../db/schema"
import { createTestDb } from "../../../test-utils/test-db"
import { loadAppData } from "../../../services/app-data"
import { updateTask } from "../../../services/tasks"
import { getLmsConnectionMethod, listLmsConnections, loadLmsFeed, saveLmsConnection, saveLmsFeedConnection } from "../connections"
import { createCredentialVault } from "../credential-vault"
import { LmsError } from "../provider"
import { syncLms } from "../sync"
import { CanvasProvider } from "./canvas-provider"
import { CANVAS_SCOPES } from "./config"
import { canvasFeedToLms, fetchCanvasFeed, parseCanvasFeedUrl } from "./feed"
import { syncCanvasFeed } from "./feed-sync"
import { parseIcs, unescapeText } from "../ical"

// Canvas calendar-feed import. TEST FIXTURES: hand-written iCalendar text
// following the format Canvas's own calendar-feed code produces (UID
// "event-assignment-<id>", SUMMARY "<title> [<course code>]", UTC DTSTART,
// calendar URL with include_contexts=course_<id>). Not real Canvas data.

const BASE = "https://school.instructure.com"
const FEED = `${BASE}/feeds/calendars/user_AbC123xyz.ics`
const vault = createCredentialVault(randomBytes(32))
const hosts = ["*.instructure.com"]

type Item = { id: number; title: string; code?: string; courseId?: number; due?: string; allDay?: string; kind?: string; description?: string }

function feedText(items: Item[]): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Instructure//Canvas//EN (test fixture)"]
  for (const item of items) {
    lines.push("BEGIN:VEVENT")
    lines.push(`UID:event-${item.kind ?? "assignment"}-${item.id}`)
    lines.push(`SUMMARY:${item.title}${item.code ? ` [${item.code}]` : ""}`)
    if (item.allDay) lines.push(`DTSTART;VALUE=DATE:${item.allDay}`)
    else lines.push(`DTSTART;TZID=UTC:${item.due ?? "20260926T035900"}`, `DTEND;TZID=UTC:${item.due ?? "20260926T035900"}`)
    if (item.description) lines.push(`DESCRIPTION:${item.description}`)
    if (item.courseId) lines.push(`URL;VALUE=URI:${BASE}/calendar?include_contexts=course_${item.courseId}&month=09&year=2026#assignment_${item.id}`)
    lines.push("END:VEVENT")
  }
  lines.push("END:VCALENDAR")
  return lines.join("\r\n")
}

const serve = (body: string | (() => string), status = 200) =>
  (async () => new Response(typeof body === "function" ? body() : body, { status, headers: { "Content-Type": "text/calendar" } })) as typeof fetch

describe("iCalendar reading", () => {
  it("reads folded lines, escaped text and all three kinds of start time", () => {
    const [utc, zoned, allDay] = parseIcs(
      [
        "BEGIN:VCALENDAR",
        "BEGIN:VEVENT",
        "UID:event-assignment-1",
        "SUMMARY:Essay\\, part 1 [ENG 10]",
        "DESCRIPTION:Line one\\nline two that is folded",
        "  onto the next line",
        "DTSTART:20260926T035900Z",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:event-assignment-2",
        "DTSTART;TZID=America/New_York:20260925T235900",
        "END:VEVENT",
        "BEGIN:VEVENT",
        "UID:event-assignment-3",
        "DTSTART;VALUE=DATE:20261001",
        "END:VEVENT",
        "END:VCALENDAR",
      ].join("\r\n")
    )
    expect(utc).toMatchObject({ summary: "Essay, part 1 [ENG 10]", description: "Line one\nline two that is folded onto the next line" })
    expect(utc.start).toEqual({ kind: "instant", instant: new Date("2026-09-26T03:59:00Z") })
    expect(zoned.start).toEqual({ kind: "instant", instant: new Date("2026-09-26T03:59:00Z") })
    expect(allDay.start).toEqual({ kind: "date", date: "2026-10-01" })
    expect(unescapeText("a\\\\b\\;c")).toBe("a\\b;c")
  })
})

describe("the feed link", () => {
  it("accepts a Canvas calendar feed link (https or webcal)", () => {
    expect(parseCanvasFeedUrl(FEED, hosts)).toEqual({ baseUrl: BASE, feedUrl: FEED })
    expect(parseCanvasFeedUrl(FEED.replace("https", "webcal"), hosts).feedUrl).toBe(FEED)
  })

  it("refuses anything that isn't a Canvas feed on an allowed host", () => {
    for (const bad of [
      "",
      "https://evil.example.com/feeds/calendars/user_x.ics",
      "http://school.instructure.com/feeds/calendars/user_x.ics",
      `${BASE}/api/v1/courses`,
      `${BASE}/feeds/calendars/../../admin.ics`,
      "https://127.0.0.1/feeds/calendars/user_x.ics",
      "not a link",
    ]) {
      expect(() => parseCanvasFeedUrl(bad, hosts), bad).toThrow(LmsError)
    }
  })
})

describe("feed -> normalized Canvas data", () => {
  it("turns assignments into courses and assignments with the same ids as the Canvas API", () => {
    const text = feedText([
      { id: 11, title: "Project 1", code: "CSC 215", courseId: 215, description: "Build a list" },
      { id: 12, title: "Reading [ch. 3]", code: "PSY101", courseId: 101, allDay: "20260930" },
      { id: 13, title: "Discussion reply", code: "PSY101", courseId: 101, kind: "sub-assignment" },
      { id: 90, title: "Lecture", code: "CSC 215", courseId: 215, kind: "calendar-event" }, // not an assignment
      { id: 91, title: "No course link", code: "CSC 215" }, // can't tell which course
    ])
    const data = canvasFeedToLms(text, { baseUrl: BASE, timeZone: "America/New_York" })
    expect(data.courses).toEqual([
      { provider: "canvas", externalId: "215", courseCode: "CSC 215", courseName: "CSC 215", description: null, instructor: null, url: `${BASE}/courses/215` },
      { provider: "canvas", externalId: "101", courseCode: "PSY101", courseName: "PSY101", description: null, instructor: null, url: `${BASE}/courses/101` },
    ])
    expect(data.assignments.map((a) => [a.externalId, a.courseExternalId, a.title, a.dueDate, a.dueTime])).toEqual([
      ["11", "215", "Project 1", "2026-09-25", "23:59"],
      ["12", "101", "Reading [ch. 3]", "2026-09-30", null],
      ["sub-assignment-13", "101", "Discussion reply", "2026-09-25", "23:59"],
    ])
    expect(data.assignments[0]).toMatchObject({
      description: "Build a list",
      url: `${BASE}/calendar?include_contexts=course_215&month=09&year=2026#assignment_11`,
      estimatedMinutes: null,
      submissionStatus: "unknown",
    })
    expect(data.skippedEvents).toBe(2)
  })
})

describe("downloading the feed", () => {
  it("returns the calendar, and explains a dead link, an outage or something that isn't a calendar", async () => {
    await expect(fetchCanvasFeed(FEED, serve(feedText([])))).resolves.toContain("BEGIN:VCALENDAR")
    await expect(fetchCanvasFeed(FEED, serve("gone", 404))).rejects.toMatchObject({ reconnect: true })
    await expect(fetchCanvasFeed(FEED, serve("oops", 503))).rejects.toThrow("temporarily unavailable")
    await expect(fetchCanvasFeed(FEED, serve("<html>login</html>"))).rejects.toThrow("didn't return a Canvas calendar")
    await expect(fetchCanvasFeed(FEED, (async () => Promise.reject(new TypeError("x"))) as typeof fetch)).rejects.toThrow("temporarily unavailable")
  })

  it("stops reading a feed that's too large", async () => {
    const huge = "BEGIN:VCALENDAR\r\n" + "X".repeat(6 * 1024 * 1024)
    await expect(fetchCanvasFeed(FEED, serve(huge))).rejects.toThrow("too large")
  })

  it("never follows redirects", async () => {
    let options: RequestInit | undefined
    await fetchCanvasFeed(FEED, (async (_: RequestInfo | URL, init?: RequestInit) => {
      options = init
      return new Response(feedText([]))
    }) as typeof fetch)
    expect(options?.redirect).toBe("error")
  })
})

// ---- The whole sync, on a real Postgres ------------------------------------------

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const NOW = new Date("2026-09-23T12:00:00Z")
let current: string
const sync = (user: string) => syncCanvasFeed(t.db, user, vault, { now: NOW, timeZone: "America/New_York", fetch: serve(() => current) })

async function feedStudent(name = "Alex") {
  const user = await t.addUser(name)
  await saveLmsFeedConnection(t.db, user, "canvas", { baseUrl: BASE, feedUrl: FEED }, vault)
  return user
}

describe("syncing a Canvas calendar feed", () => {
  it("stores the link encrypted and never reveals it", async () => {
    const user = await feedStudent()
    const [row] = await t.db.select().from(lmsConnections)
    expect(row.feedUrlEncrypted).not.toContain("user_AbC123xyz")
    expect(row.method).toBe("calendar_feed")
    expect(JSON.stringify(await listLmsConnections(t.db, user))).not.toContain("feeds")
    expect((await loadLmsFeed(t.db, user, "canvas", vault)).feedUrl).toBe(FEED)
    expect(await getLmsConnectionMethod(t.db, user, "canvas")).toBe("calendar_feed")
  })

  it("imports assignments as normal tasks, with no duplicates on repeat syncs", async () => {
    const user = await feedStudent()
    current = feedText([
      { id: 11, title: "Project 1", code: "CSC 215", courseId: 215 },
      { id: 12, title: "Reading", code: "PSY101", courseId: 101, allDay: "20260930" },
    ])
    expect(await sync(user)).toMatchObject({ coursesCreated: 2, assignmentsCreated: 2, errors: [] })
    expect(await sync(user)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })
    const data = await loadAppData(t.db, user)
    expect(data.courses.map((c) => c.code).sort()).toEqual(["CSC 215", "PSY101"])
    expect(data.tasks).toHaveLength(2)
    expect(data.tasks.find((task) => task.title === "Project 1")).toMatchObject({
      dueDate: "2026-09-25",
      dueTime: "23:59",
      source: { provider: "canvas", externalId: "11" },
    })
  })

  it("updates moved deadlines, keeps the student's own changes, and never deletes", async () => {
    const user = await feedStudent()
    current = feedText([
      { id: 11, title: "Project 1", code: "CSC 215", courseId: 215 },
      { id: 12, title: "Essay", code: "CSC 215", courseId: 215, due: "20260929T035900" },
      { id: 13, title: "Old quiz", code: "CSC 215", courseId: 215, due: "20260910T035900" },
    ])
    await sync(user)
    const essay = (await loadAppData(t.db, user)).tasks.find((task) => task.title === "Essay")!
    await updateTask(t.db, user, essay.id, { dueDate: "2026-09-30" }) // the student gives themselves more time

    // Canvas moves Project 1 and Essay, and the feed drops the essay and the old quiz.
    current = feedText([
      { id: 11, title: "Project 1", code: "CSC 215", courseId: 215, due: "20260927T035900" },
      { id: 12, title: "Essay", code: "CSC 215", courseId: 215, due: "20261001T035900" },
    ])
    const moved = await sync(user)
    expect(moved.assignmentsUpdated).toBe(1)
    // The student and Canvas both moved the essay to Sep 30: they agree, so no conflict.
    expect(moved.conflicts).toEqual([])
    const tasks = (await loadAppData(t.db, user)).tasks
    expect(tasks.find((task) => task.title === "Project 1")?.dueDate).toBe("2026-09-26")
    expect(tasks.find((task) => task.title === "Essay")?.dueDate).toBe("2026-09-30") // the student's date stays

    current = feedText([{ id: 11, title: "Project 1", code: "CSC 215", courseId: 215, due: "20260927T035900" }])
    const dropped = await sync(user)
    // The essay (due ahead) is reported; the old quiz (already past) isn't: feeds drop old items.
    expect(dropped.missing.map((m) => m.title)).toEqual(["Essay"])
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(3) // nothing deleted
  })

  it("asks for a new link when Canvas no longer accepts it", async () => {
    const user = await feedStudent()
    await expect(
      syncCanvasFeed(t.db, user, vault, { now: NOW, fetch: serve("gone", 404) })
    ).rejects.toThrow("This Canvas calendar feed link no longer works")
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({ status: "needs_reauth" })
  })

  it("keeps each student's feed and data separate", async () => {
    const alice = await feedStudent("Alice")
    const bob = await t.addUser("Bob")
    await expect(syncCanvasFeed(t.db, bob, vault, { now: NOW, fetch: serve(feedText([])) })).rejects.toThrow("doesn't exist")
    await expect(loadLmsFeed(t.db, bob, "canvas", vault)).rejects.toThrow("doesn't exist")
    current = feedText([{ id: 11, title: "Project 1", code: "CSC 215", courseId: 215 }])
    await sync(alice)
    expect((await loadAppData(t.db, bob)).tasks).toEqual([])
  })

  it("imported tasks are planned like any other", async () => {
    const user = await feedStudent()
    current = feedText([{ id: 11, title: "Project 1", code: "CSC 215", courseId: 215 }])
    await sync(user)
    const data = await loadAppData(t.db, user)
    const plan = generatePlan({ date: "2026-09-23", tasks: data.tasks, events: data.events, now: new Date(2026, 8, 23, 8, 0) })
    expect(plan.suggestions.map((s) => s.taskId)).toContain(data.tasks[0].id)
  })

  it("switching to a Canvas sign-in later reuses the same courses and tasks (no duplicates)", async () => {
    const user = await feedStudent()
    current = feedText([{ id: 11, title: "Project 1", code: "CSC 215", courseId: 215 }])
    await sync(user)

    // Later the school approves a developer key and the student signs in (OAuth replaces the feed).
    await saveLmsConnection(
      t.db,
      user,
      "canvas",
      { accessToken: "api-token", refreshToken: "refresh", expiresAt: new Date("2026-09-23T13:00:00Z"), externalUserId: "1", baseUrl: BASE },
      vault
    )
    const api = (async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname
      const json = (body: unknown) => new Response(JSON.stringify(body))
      if (path === "/api/v1/courses") return json([{ id: 215, name: "Data Structures", course_code: "CSC 215", workflow_state: "available" }])
      if (path === "/api/v1/courses/215/assignments") {
        return json([{ id: 11, name: "Project 1", due_at: "2026-09-26T03:59:00Z", published: true, html_url: `${BASE}/courses/215/assignments/11` }])
      }
      return new Response("{}", { status: 404 })
    }) as typeof fetch
    const provider = new CanvasProvider({
      fetch: api,
      config: () => ({ clientId: "id", clientSecret: "secret", redirectUri: "http://localhost/cb", allowedHosts: hosts, scopes: CANVAS_SCOPES }),
    })
    const result = await syncLms(t.db, user, provider, vault, { now: NOW, timeZone: "America/New_York" })
    expect(result).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0 })
    const data = await loadAppData(t.db, user)
    expect(data.courses).toHaveLength(1)
    expect(data.courses[0].name).toBe("Data Structures") // the API has the full name
    expect(data.tasks).toHaveLength(1)
    expect(await getLmsConnectionMethod(t.db, user, "canvas")).toBe("oauth")
  })
})
