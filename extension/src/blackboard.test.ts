import { describe, expect, it, vi } from "vitest"
import { readBlackboard } from "./blackboard"
import { courseOptions, groupByTerm } from "./courses"

// readBlackboard against a fake Blackboard Learn (TEST FIXTURES shaped after the
// Learn REST API spec and what a real Ultra site returned to a student's session).

const ORIGIN = "https://school.blackboard.com"
const NOW = Date.parse("2026-09-25T15:00:00Z")
const COURSES = { kind: "courses" } as const
const assignmentsOf = (...ids: string[]) => ({ kind: "assignments" as const, courseIds: ids })

type Route = { status?: number; body: unknown }
function fakeBlackboard(routes: Record<string, Route>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const route = routes[url.pathname + (url.searchParams.has("offset") ? `?offset=${url.searchParams.get("offset")}` : "")] ?? routes[url.pathname]
    if (!route) return new Response(JSON.stringify({ status: 404, message: "Not found" }), { status: 404 })
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 })
  }) as unknown as typeof fetch
}

const me = { "/learn/api/public/v1/users/me": { body: { id: "_42_1" } } }
const membership = (id: string, name: string, termId: string | null, extra: Record<string, unknown> = {}) => ({
  courseId: id,
  courseRoleId: "Student",
  availability: { available: "Yes" },
  course: { id, courseId: `${name.slice(0, 3).toUpperCase()}-101`, name, organization: false, availability: { available: "Yes" }, externalAccessUrl: `${ORIGIN}/ultra/courses/${id}/outline`, termId, uuid: "secret-uuid", enrollment: { type: "InstructorLed" } },
  ...extra,
})
const terms = {
  "/learn/api/public/v1/terms": {
    body: {
      results: [
        { id: "_11_1", name: "Fall 2026", availability: { duration: { type: "DateRange", start: "2026-08-25T04:00:00.000Z", end: "2026-12-20T05:00:00.000Z" } } },
        { id: "_10_1", name: "Spring 2026", availability: { duration: { type: "DateRange", start: "2026-01-15T05:00:00.000Z", end: "2026-05-15T04:00:00.000Z" } } },
      ],
    },
  },
}

describe("readBlackboard: courses", () => {
  it("lists the student's courses with their terms, ready for the course list", async () => {
    const fetchFn = fakeBlackboard({
      ...me,
      ...terms,
      "/learn/api/public/v1/users/_42_1/courses": {
        body: {
          results: [
            membership("_215_1", "Data Structures", "_11_1"),
            membership("_101_1", "Intro to Psychology", "_10_1"),
            membership("_300_1", "TA Lab", "_11_1", { courseRoleId: "TeachingAssistant" }),
            membership("_301_1", "Chess Club", null, { course: { ...membership("_301_1", "Chess Club", null).course, organization: true } }),
            membership("_302_1", "Closed", "_10_1", { availability: { available: "No" } }),
          ],
        },
      },
    })
    const read = await readBlackboard(COURSES, ORIGIN, fetchFn, NOW)
    if (!read.ok || read.kind !== "courses") throw new Error("expected courses")
    expect(read.courses.map((m) => (m.course as { id: string }).id)).toEqual(["_215_1", "_101_1"])
    // Only the fields Student OS uses leave the tab.
    expect(JSON.stringify(read.courses)).not.toMatch(/secret-uuid|enrollment|termId/)
    // Grouped by semester, current first (the same list as Canvas).
    const groups = groupByTerm(courseOptions(read.choices), NOW)
    expect(groups.map((g) => [g.name, g.current, g.courses.map((c) => c.label)])).toEqual([
      ["Fall 2026", true, ["DAT-101 · Data Structures"]],
      ["Spring 2026", false, ["INT-101 · Intro to Psychology"]],
    ])
  })

  it("always uses full Blackboard addresses (Ultra's <base href> points to a CDN)", async () => {
    const fetchFn = fakeBlackboard({ ...me, ...terms, "/learn/api/public/v1/users/_42_1/courses": { body: { results: [] } } })
    await readBlackboard(COURSES, ORIGIN, fetchFn, NOW)
    const urls = vi.mocked(fetchFn).mock.calls.map(([url]) => String(url))
    expect(urls.every((url) => url.startsWith(`${ORIGIN}/learn/api/public/`))).toBe(true)
    expect(vi.mocked(fetchFn).mock.calls[0][1]).toMatchObject({ credentials: "same-origin" })
  })

  it("follows paging.nextPage on the same Blackboard only", async () => {
    const fetchFn = fakeBlackboard({
      ...me,
      ...terms,
      "/learn/api/public/v1/users/_42_1/courses": {
        body: { results: [membership("_1_1", "One", "_11_1")], paging: { nextPage: "/learn/api/public/v1/users/_42_1/courses?offset=1" } },
      },
      "/learn/api/public/v1/users/_42_1/courses?offset=1": {
        body: { results: [membership("_2_1", "Two", "_11_1")], paging: { nextPage: "https://evil.example.com/steal?offset=2" } },
      },
    })
    const read = await readBlackboard(COURSES, ORIGIN, fetchFn, NOW)
    if (!read.ok || read.kind !== "courses") throw new Error("expected courses")
    expect(read.choices.map((c) => c.id)).toEqual(["_1_1", "_2_1"])
    expect(vi.mocked(fetchFn).mock.calls.some(([url]) => String(url).includes("evil"))).toBe(false)
  })

  it("without terms (not allowed at some schools), courses are still listed", async () => {
    const fetchFn = fakeBlackboard({
      ...me,
      "/learn/api/public/v1/terms": { status: 403, body: { status: 403 } },
      "/learn/api/public/v1/users/_42_1/courses": { body: { results: [membership("_215_1", "Data Structures", "_11_1")] } },
    })
    const read = await readBlackboard(COURSES, ORIGIN, fetchFn, NOW)
    if (!read.ok || read.kind !== "courses") throw new Error("expected courses")
    expect(read.choices).toEqual([{ id: "_215_1", name: "Data Structures", course_code: "DAT-101" }])
  })

  it("says when the student is logged out, or the tab isn't Blackboard", async () => {
    expect(await readBlackboard(COURSES, ORIGIN, fakeBlackboard({ "/learn/api/public/v1/users/me": { status: 401, body: {} } }))).toEqual({ ok: false, reason: "logged-out" })
    expect(await readBlackboard(COURSES, "https://example.com", fakeBlackboard({}))).toEqual({ ok: false, reason: "not-blackboard" })
    expect(await readBlackboard(COURSES, ORIGIN, fakeBlackboard({ "/learn/api/public/v1/users/me": { body: { hello: 1 } } }))).toEqual({ ok: false, reason: "not-blackboard" })
  })
})

describe("readBlackboard: assignments", () => {
  const column = (id: string, name: string, due: string | null, type = "Attempts", extra: Record<string, unknown> = {}) => ({
    id,
    name,
    description: "<p>" + "x".repeat(5000) + "</p>",
    scoreProviderHandle: "resource/x-bb-assignment",
    grading: { type, ...(due ? { due } : {}), schema: "secret-schema" },
    score: { possible: 100 },
    ...extra,
  })
  const course = (columns: unknown[], grades: unknown[] = []) => ({
    "/learn/api/public/v2/courses/_215_1/gradebook/columns": { body: { results: columns } },
    "/learn/api/public/v2/courses/_215_1/gradebook/users/_42_1": { body: { results: grades } },
  })

  it("reads columns, the student's grades and recent attempts; keeps only what Student OS uses", async () => {
    const fetchFn = fakeBlackboard({
      ...me,
      ...course(
        [column("_1_1", "Project 1", "2026-10-02T03:59:00.000Z"), column("_2_1", "Quiz 1", "2026-09-20T03:59:00.000Z"), column("_3_1", "Total", null, "Calculated")],
        [{ columnId: "_2_1", score: 9, feedback: "private feedback", changeIndex: 3 }]
      ),
      "/learn/api/public/v2/courses/_215_1/gradebook/columns/_1_1/attempts": { body: { results: [{ status: "NeedsGrading", score: 50, studentComments: "private" }] } },
      "/learn/api/public/v1/courses/_215_1/users": {
        body: {
          results: [
            { courseRoleId: "Instructor", user: { name: { given: "Jane", family: "Smith", title: "Dr." }, userName: "jsmith", contact: { email: "private@school.edu" } } },
            { courseRoleId: "Instructor", user: { name: { given: "Ali", family: "Khan" } } },
            { courseRoleId: "Student", user: { name: { given: "Classmate", family: "Private" } } },
          ],
        },
      },
    })
    const read = await readBlackboard(assignmentsOf("_215_1"), ORIGIN, fetchFn, NOW)
    if (!read.ok || read.kind !== "assignments") throw new Error("expected assignments")
    expect(read.columns._215_1.map((c) => (c as { id: string }).id)).toEqual(["_1_1", "_2_1", "_3_1"])
    expect((read.columns._215_1[0] as { description: string }).description).toHaveLength(4000)
    expect(read.grades._215_1).toEqual([{ columnId: "_2_1", score: 9 }])
    // Quiz 1 is graded already: no attempt lookup for it.
    expect(read.attempts).toEqual({ _1_1: [{ status: "NeedsGrading" }] })
    // The instructors' names only (never a classmate, never an email or username).
    expect(read.instructors).toEqual({ _215_1: ["Jane Smith", "Ali Khan"] })
    expect(vi.mocked(fetchFn).mock.calls.map(([url]) => String(url))).toContain(
      `${ORIGIN}/learn/api/public/v1/courses/_215_1/users?role=Instructor&expand=user&fields=courseRoleId,user.name.given,user.name.family`
    )
    expect(JSON.stringify(read)).not.toMatch(/private|Private|jsmith|changeIndex|studentComments|"possible"/)
  })

  it("looks up attempts only for recent assignments, at most 25 per course, closest to today first", async () => {
    const days = (n: number) => new Date(NOW + n * 24 * 60 * 60 * 1000).toISOString()
    const columns = [
      column("_900_1", "Long ago", days(-60)),
      ...Array.from({ length: 30 }, (_, i) => column(`_${i + 1}_1`, `A${i + 1}`, days(i + 1))),
    ]
    const fetchFn = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith("/users/me")) return Response.json({ id: "_42_1" })
      if (url.pathname.endsWith("/gradebook/columns")) return Response.json({ results: columns })
      if (url.pathname.includes("/gradebook/users/")) return Response.json({ results: [] })
      return Response.json({ results: [] })
    }) as unknown as typeof fetch
    const read = await readBlackboard(assignmentsOf("_215_1"), ORIGIN, fetchFn, NOW)
    if (!read.ok || read.kind !== "assignments") throw new Error("expected assignments")
    const looked = Object.keys(read.attempts)
    expect(looked).toHaveLength(25)
    expect(looked).not.toContain("_900_1")
    expect(looked).toContain("_1_1")
    expect(looked).not.toContain("_30_1")
  })

  it("a course whose columns can't be read is left out; hidden grades just mean no grades", async () => {
    const fetchFn = fakeBlackboard({
      ...me,
      "/learn/api/public/v2/courses/_215_1/gradebook/columns": { body: { results: [column("_1_1", "Project 1", null, "Manual")] } },
      "/learn/api/public/v2/courses/_215_1/gradebook/users/_42_1": { status: 403, body: {} },
      "/learn/api/public/v2/courses/_216_1/gradebook/columns": { status: 403, body: {} },
    })
    const read = await readBlackboard(assignmentsOf("_215_1", "_216_1"), ORIGIN, fetchFn, NOW)
    // Instructors hidden from students (no route here: 404): the course just has no professor.
    expect(read).toMatchObject({ ok: true, coursesUnreadable: 1, grades: {}, instructors: {} })
    if (read.ok && read.kind === "assignments") expect(Object.keys(read.columns)).toEqual(["_215_1"])
  })

  it("only reads Blackboard-shaped course ids (nothing else ends up in an address)", async () => {
    const fetchFn = fakeBlackboard({ ...me })
    await readBlackboard(assignmentsOf("../../v1/users", "_1_1?x=1", "215"), ORIGIN, fetchFn, NOW)
    expect(vi.mocked(fetchFn).mock.calls).toHaveLength(1)
  })

  it("is self-contained, so Chrome can copy it into the Blackboard tab", () => {
    const copy = new Function(`return ${readBlackboard.toString()}`)() as typeof readBlackboard
    return expect(copy(COURSES, "https://example.com", fakeBlackboard({}), NOW)).resolves.toEqual({ ok: false, reason: "not-blackboard" })
  })
})
