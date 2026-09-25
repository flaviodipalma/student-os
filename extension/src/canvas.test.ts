import { describe, expect, it, vi } from "vitest"
import { readCanvas } from "./canvas"

// readCanvas against a fake Canvas (TEST FIXTURES shaped after the Canvas API docs).

const ORIGIN = "https://school.instructure.com"
const COURSES = { kind: "courses" } as const
const assignmentsOf = (...ids: number[]) => ({ kind: "assignments" as const, courseIds: ids.map(String) })

type Route = { status?: number; body: unknown; link?: string; raw?: string }
function fakeCanvas(routes: Record<string, Route | ((url: URL) => Route)>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const key = url.pathname + (url.searchParams.has("page") ? `?page=${url.searchParams.get("page")}` : "")
    const route = routes[key] ?? routes[url.pathname]
    if (!route) return new Response("<html>Not found</html>", { status: 404 })
    const { status = 200, body, link, raw } = typeof route === "function" ? route(url) : route
    return new Response(raw ?? JSON.stringify(body), { status, headers: link ? { Link: link } : {} })
  }) as unknown as typeof fetch
}

const course = (id: number, extra: Record<string, unknown> = {}) => ({ id, name: `Course ${id}`, course_code: `C${id}`, ...extra })
const assignment = (id: number, extra: Record<string, unknown> = {}) => ({
  id,
  name: `Assignment ${id}`,
  due_at: "2026-10-01T03:59:00Z",
  published: true,
  submission: { workflow_state: "submitted", score: 9, grade: "A" },
  ...extra,
})

describe("readCanvas", () => {
  const term = { id: 11, name: "Fall 2026", start_at: "2026-08-25T04:00:00Z", end_at: "2026-12-20T05:00:00Z", workflow_state: "active" }

  it("step 1 reads active courses with their term; step 2 only the chosen courses' assignments", async () => {
    const fetchFn = fakeCanvas({
      "/api/v1/users/self": { body: { id: 42, name: "Alex" } },
      "/api/v1/courses": { body: [course(215, { term, teachers: [{ display_name: "Prof. Smith", id: 7, avatar_url: "x" }] }), course(216)] },
      "/api/v1/courses/215/assignments": { body: [assignment(1)] },
      "/api/v1/courses/216/assignments": { body: [assignment(2)] },
    })
    expect(await readCanvas(COURSES, ORIGIN, fetchFn)).toEqual({
      ok: true,
      kind: "courses",
      baseUrl: ORIGIN,
      courses: [
        {
          id: 215,
          name: "Course 215",
          course_code: "C215",
          teachers: [{ display_name: "Prof. Smith" }],
          term: { id: 11, name: "Fall 2026", start_at: "2026-08-25T04:00:00Z", end_at: "2026-12-20T05:00:00Z" },
        },
        { id: 216, name: "Course 216", course_code: "C216" },
      ],
    })
    expect(await readCanvas({ kind: "assignments", courseIds: ["215"] }, ORIGIN, fetchFn)).toEqual({
      ok: true,
      kind: "assignments",
      baseUrl: ORIGIN,
      assignments: { "215": [{ id: 1, name: "Assignment 1", due_at: "2026-10-01T03:59:00Z", published: true, submission: { workflow_state: "submitted" } }] },
      coursesUnreadable: 0,
    })
    // Same-origin requests with the student's login, asking for the right things, and
    // nothing from the course that wasn't chosen.
    const urls = vi.mocked(fetchFn).mock.calls.map(([url]) => String(url))
    expect(urls.every((url) => url.startsWith(ORIGIN))).toBe(true)
    expect(urls).toContain(`${ORIGIN}/api/v1/courses?enrollment_type=student&enrollment_state=active&include[]=teachers&include[]=term&per_page=100`)
    expect(urls).toContain(`${ORIGIN}/api/v1/courses/215/assignments?include[]=submission&order_by=due_at&per_page=100`)
    expect(urls.some((url) => url.includes("/courses/216/"))).toBe(false)
    expect(vi.mocked(fetchFn).mock.calls[0][1]).toMatchObject({ credentials: "same-origin" })
  })

  it("only reads numeric course ids (nothing else ends up in a Canvas address)", async () => {
    const fetchFn = fakeCanvas({ "/api/v1/users/self": { body: { id: 42 } } })
    await readCanvas({ kind: "assignments", courseIds: ["../users/self", "1?x=1"] }, ORIGIN, fetchFn)
    expect(vi.mocked(fetchFn).mock.calls).toHaveLength(1)
  })

  it("keeps only the fields Student OS uses (no grades, scores or anything else)", async () => {
    const fetchFn = fakeCanvas({
      "/api/v1/users/self": { body: { id: 42 } },
      "/api/v1/courses": { body: [course(1, { enrollments: [{ computed_current_score: 91 }], calendar: { ics: "secret" } })] },
      "/api/v1/courses/1/assignments": {
        body: [assignment(1, { description: "<p>" + "x".repeat(10_000) + "</p>", points_possible: 10, rubric: [{}], secure_params: "s" })],
      },
    })
    const courses = await readCanvas(COURSES, ORIGIN, fetchFn)
    const read = await readCanvas(assignmentsOf(1), ORIGIN, fetchFn)
    if (read.ok === false || read.kind !== "assignments") throw new Error("expected assignments")
    const sent = JSON.stringify([courses, read])
    expect(sent).not.toMatch(/computed_current_score|secret|points_possible|rubric|secure_params|"score"|"grade"/)
    expect((read.assignments["1"][0] as { description: string }).description).toHaveLength(4000)
  })

  it("follows Canvas's next-page links, and handles the while(1); prefix", async () => {
    const fetchFn = fakeCanvas({
      "/api/v1/users/self": { raw: 'while(1);{"id":42}', body: null },
      "/api/v1/courses": { body: [course(1)], link: `<${ORIGIN}/api/v1/courses?page=2&per_page=100>; rel="next", <${ORIGIN}/api/v1/courses?page=1>; rel="first"` },
      "/api/v1/courses?page=2": { raw: `while(1);${JSON.stringify([course(2)])}`, body: null },
      "/api/v1/courses/1/assignments": { body: [assignment(1)] },
      "/api/v1/courses/2/assignments": { body: [assignment(2), assignment(3)] },
    })
    const courses = await readCanvas(COURSES, ORIGIN, fetchFn)
    if (courses.ok === false || courses.kind !== "courses") throw new Error("expected courses")
    expect(courses.courses.map((c) => c.id)).toEqual([1, 2])
    const read = await readCanvas(assignmentsOf(1, 2), ORIGIN, fetchFn)
    if (read.ok === false || read.kind !== "assignments") throw new Error("expected assignments")
    expect(read.assignments["2"]).toHaveLength(2)
  })

  it("never follows a next-page link to another site", async () => {
    const fetchFn = fakeCanvas({
      "/api/v1/users/self": { body: { id: 42 } },
      "/api/v1/courses": { body: [course(1)], link: `<https://evil.example.com/steal?page=2>; rel="next"` },
      "/api/v1/courses/1/assignments": { body: [] },
    })
    await readCanvas(COURSES, ORIGIN, fetchFn)
    expect(vi.mocked(fetchFn).mock.calls.map(([url]) => String(url)).some((url) => url.includes("evil"))).toBe(false)
  })

  it("a course whose assignments can't be read is left out and counted", async () => {
    const fetchFn = fakeCanvas({
      "/api/v1/users/self": { body: { id: 42 } },
      "/api/v1/courses": { body: [course(1), course(2)] },
      "/api/v1/courses/1/assignments": { body: [assignment(1)] },
      "/api/v1/courses/2/assignments": { status: 403, body: { errors: [{ message: "unauthorized" }] } },
    })
    const read = await readCanvas(assignmentsOf(1, 2), ORIGIN, fetchFn)
    expect(read).toMatchObject({ ok: true, coursesUnreadable: 1 })
    if (read.ok && read.kind === "assignments") expect(Object.keys(read.assignments)).toEqual(["1"])
  })

  it("says when the student is logged out of Canvas", async () => {
    const fetchFn = fakeCanvas({ "/api/v1/users/self": { status: 401, body: { status: "unauthenticated" } } })
    expect(await readCanvas(COURSES, ORIGIN, fetchFn)).toEqual({ ok: false, reason: "logged-out" })
    expect(await readCanvas(assignmentsOf(1), ORIGIN, fetchFn)).toEqual({ ok: false, reason: "logged-out" })
  })

  it("says when the tab isn't Canvas", async () => {
    // A 404 page, a JSON API that isn't Canvas, and no network at all.
    expect(await readCanvas(COURSES, "https://example.com", fakeCanvas({}))).toEqual({ ok: false, reason: "not-canvas" })
    expect(await readCanvas(COURSES, "https://example.com", fakeCanvas({ "/api/v1/users/self": { body: { hello: "world" } } }))).toEqual({
      ok: false,
      reason: "not-canvas",
    })
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    expect(await readCanvas(COURSES, ORIGIN, offline)).toEqual({ ok: false, reason: "not-canvas" })
  })

  it("reads a few courses at a time, not all at once", async () => {
    let inFlight = 0
    let most = 0
    const ids = Array.from({ length: 10 }, (_, i) => i + 1)
    const fetchFn = fakeCanvas({
      "/api/v1/users/self": { body: { id: 42 } },
      "/api/v1/courses": { body: ids.map((id) => course(id)) },
    })
    const counting = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("/assignments")) return fetchFn(input, init)
      inFlight++
      most = Math.max(most, inFlight)
      await new Promise((resolve) => setTimeout(resolve, 5))
      inFlight--
      return new Response("[]")
    }) as unknown as typeof fetch
    const read = await readCanvas(assignmentsOf(...ids), ORIGIN, counting)
    expect(read).toMatchObject({ ok: true, coursesUnreadable: 0 })
    expect(most).toBeLessThanOrEqual(4)
  })

  it("is self-contained, so Chrome can copy it into the Canvas tab", () => {
    // Rebuilt from its source text alone (what executeScript does), it still works.
    const copy = new Function(`return ${readCanvas.toString()}`)() as typeof readCanvas
    expect(typeof copy).toBe("function")
    return expect(copy(COURSES, "https://example.com", fakeCanvas({}))).resolves.toEqual({ ok: false, reason: "not-canvas" })
  })
})
