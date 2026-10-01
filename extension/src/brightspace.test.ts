import { describe, expect, it, vi } from "vitest"
import { detectionOrder } from "./auto-sync"
import { readBrightspace } from "./brightspace"
import { courseOptions, groupByTerm } from "./courses"

// readBrightspace against a fake D2L Brightspace (TEST FIXTURES shaped after D2L's
// Valence API reference: versions, whoami, myenrollments, course offerings,
// dropbox folders, quizzes, mysubmissions).

const ORIGIN = "https://school.brightspace.com"
const NOW = Date.parse("2026-09-25T15:00:00Z")
const COURSES = { kind: "courses" } as const
const assignmentsOf = (...ids: string[]) => ({ kind: "assignments" as const, courseIds: ids })
const LP = "/d2l/api/lp/1.46"
const LE = "/d2l/api/le/1.78"

type Route = { status?: number; body: unknown }
function fakeBrightspace(routes: Record<string, Route>, { cookiesWork = true } = {}) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const key = url.pathname + (url.searchParams.has("bookmark") ? `?bookmark=${url.searchParams.get("bookmark")}` : "")
    if (url.pathname === "/d2l/lp/auth/oauth2/token") {
      const csrf = new Headers(init?.headers).get("x-csrf-token")
      return csrf === "csrf-123" ? Response.json({ access_token: "page-token" }) : new Response("no", { status: 403 })
    }
    const authorized = new Headers(init?.headers).get("authorization") === "Bearer page-token"
    if (url.pathname.startsWith("/d2l/api/l") && !cookiesWork && !authorized) return new Response("", { status: 403 })
    const route = routes[key] ?? routes[url.pathname]
    if (!route) return new Response("Not found", { status: 404 })
    return Response.json(route.body, { status: route.status ?? 200 })
  }) as unknown as typeof fetch
}

const base = {
  "/d2l/api/versions/": {
    body: [
      { ProductCode: "lp", LatestVersion: "1.46", SupportedVersions: ["1.45", "1.46"] },
      { ProductCode: "le", LatestVersion: "1.78", SupportedVersions: ["1.77", "1.78"] },
    ],
  },
  [`${LP}/users/whoami`]: { body: { Identifier: "300", FirstName: "Alice" } },
}
const enrollment = (id: number, name: string, start: string, extra: Record<string, unknown> = {}) => ({
  OrgUnit: { Id: id, Name: name, Code: `${name.slice(0, 3).toUpperCase()}-101`, HomeUrl: `/d2l/home/${id}`, ImageUrl: "/secret.png", Type: { Id: 3, Code: "Course Offering", Name: "Course Offering" } },
  Access: { IsActive: true, CanAccess: true, StartDate: start, EndDate: null, ClasslistRoleName: "Student", LISRoles: ["urn:lti:role:ims/lis/Learner"], LastAccessed: "2026-09-24T10:00:00Z" },
  ...extra,
})
const offering = (semester: string, start: string, end: string) => ({
  Id: 0,
  StartDate: start,
  EndDate: end,
  Semester: { Identifier: semester === "Fall 2026" ? "60" : "50", Name: semester, Code: "x" },
  Department: { Name: "Secret department" },
})
const storage = { getItem: (key: string) => (key === "XSRF.Token" ? "csrf-123" : null) }

describe("readBrightspace: courses", () => {
  it("lists the student's courses with their semesters, ready for the course list", async () => {
    const fetchFn = fakeBrightspace({
      ...base,
      [`${LP}/enrollments/myenrollments/`]: {
        body: { PagingInfo: { Bookmark: "2", HasMoreItems: true }, Items: [enrollment(6606, "Data Structures", "2026-08-31T04:00:00.000Z")] },
      },
      [`${LP}/enrollments/myenrollments/?bookmark=2`]: {
        body: {
          PagingInfo: { Bookmark: "3", HasMoreItems: false },
          Items: [
            enrollment(5505, "Intro to Psychology", "2026-01-15T05:00:00.000Z"),
            enrollment(7707, "Closed Course", "2026-08-31T04:00:00.000Z", { Access: { CanAccess: false } }),
            enrollment(8808, "Lab I Teach", "2026-08-31T04:00:00.000Z", {
              Access: { IsActive: true, CanAccess: true, ClasslistRoleName: "Teaching Assistant", LISRoles: ["urn:lti:role:ims/lis/TeachingAssistant"] },
            }),
          ],
        },
      },
      [`${LP}/courses/6606`]: { body: offering("Fall 2026", "2026-08-31T04:00:00.000Z", "2026-12-19T04:59:00.000Z") },
      [`${LP}/courses/5505`]: { body: offering("Spring 2026", "2026-01-15T05:00:00.000Z", "2026-05-15T04:00:00.000Z") },
    })
    const read = await readBrightspace(COURSES, ORIGIN, fetchFn, storage, NOW)
    if (!read.ok || read.kind !== "courses") throw new Error("expected courses")
    expect(read.baseUrl).toBe(ORIGIN)
    expect(read.courses.map((course) => (course.OrgUnit as { Id: number }).Id)).toEqual([6606, 5505])
    // Only the fields Quadernio uses travel (no image, last-accessed time or department).
    expect(JSON.stringify(read.courses)).not.toMatch(/secret|LastAccessed/i)
    expect(read.courses[0]).toMatchObject({ Offering: { StartDate: "2026-08-31T04:00:00.000Z", Semester: { Identifier: "60", Name: "Fall 2026" } } })

    const groups = groupByTerm(courseOptions(read.choices), NOW)
    expect(groups.map((group) => [group.name, group.current, group.courses.map((course) => course.label)])).toEqual([
      ["Fall 2026", true, ["DAT101 · Data Structures"]],
      ["Spring 2026", false, ["INT101 · Intro to Psychology"]],
    ])
  })

  it("tells when the tab isn't Brightspace, or the student is logged out", async () => {
    expect(await readBrightspace(COURSES, "https://example.com", fakeBrightspace({}), storage, NOW)).toEqual({ ok: false, reason: "not-brightspace" })
    const loggedOut = fakeBrightspace({ ...base, [`${LP}/users/whoami`]: { status: 401, body: {} } })
    expect(await readBrightspace(COURSES, ORIGIN, loggedOut, null, NOW)).toEqual({ ok: false, reason: "logged-out" })
  })

  it("where cookies alone aren't accepted, uses the page's own token", async () => {
    const fetchFn = fakeBrightspace(
      { ...base, [`${LP}/enrollments/myenrollments/`]: { body: { PagingInfo: { HasMoreItems: false }, Items: [enrollment(6606, "Data Structures", "2026-08-31T04:00:00.000Z")] } } },
      { cookiesWork: false }
    )
    const read = await readBrightspace(COURSES, ORIGIN, fetchFn, storage, NOW)
    expect(read).toMatchObject({ ok: true, kind: "courses" })
    // Without the page's anti-forgery token there's no token: logged out.
    expect(await readBrightspace(COURSES, ORIGIN, fetchFn, { getItem: () => null }, NOW)).toEqual({ ok: false, reason: "logged-out" })
  })
})

describe("readBrightspace: assignments", () => {
  const folder = (id: number, due: string | null, extra: Record<string, unknown> = {}) => ({
    Id: id,
    Name: `Assignment ${id}`,
    DueDate: due,
    IsHidden: false,
    CustomInstructions: { Text: "Upload a PDF.", Html: "<p>Upload a PDF.</p>" },
    Attachments: [{ FileName: "secret.pdf" }],
    TotalUsers: 40,
    ...extra,
  })

  it("reads folders, quizzes and the student's own recent submissions", async () => {
    const fetchFn = fakeBrightspace({
      ...base,
      [`${LE}/6606/dropbox/folders/`]: {
        body: [folder(11, "2026-09-26T03:59:00.000Z"), folder(12, "2026-06-01T03:59:00.000Z"), folder(13, null)],
      },
      [`${LE}/6606/quizzes/`]: { body: { Objects: [{ QuizId: 21, Name: "Quiz 1", IsActive: true, DueDate: "2026-09-30T16:00:00.000Z", Password: "hunter2" }], Next: null } },
      [`${LE}/6606/dropbox/folders/11/submissions/mysubmissions/`]: {
        body: [{ Status: 1, Entity: { DisplayName: "Alice" }, Submissions: [{ Id: 9, SubmissionDate: "2026-09-24T12:00:00.000Z", Files: [{ FileName: "essay.pdf" }] }] }],
      },
    })
    const read = await readBrightspace(assignmentsOf("6606", "../x"), ORIGIN, fetchFn, storage, NOW)
    if (!read.ok || read.kind !== "assignments") throw new Error("expected assignments")
    expect(read.folders["6606"].map((item) => (item as { Id: number }).Id)).toEqual([11, 12, 13])
    expect(read.quizzes["6606"]).toEqual([{ QuizId: 21, Name: "Quiz 1", IsActive: true, DueDate: "2026-09-30T16:00:00.000Z", Description: { Text: { Text: null } } }])
    // Only recent folders are looked up (12 is months old, 13 has no due date).
    expect(Object.keys(read.submissions)).toEqual(["11"])
    expect(read.submissions["11"]).toEqual([{ Status: 1, Submissions: [{ SubmissionDate: "2026-09-24T12:00:00.000Z" }] }])
    // No attachments, files, names, passwords or class totals leave the browser.
    expect(JSON.stringify(read)).not.toMatch(/secret|essay|Alice|hunter2|TotalUsers/)
    expect(read.coursesUnreadable).toBe(0)
  })

  it("a course whose folders can't be read is counted, not sent", async () => {
    const fetchFn = fakeBrightspace({ ...base, [`${LE}/6606/dropbox/folders/`]: { status: 500, body: {} } })
    const read = await readBrightspace(assignmentsOf("6606"), ORIGIN, fetchFn, storage, NOW)
    expect(read).toMatchObject({ ok: true, kind: "assignments", folders: {}, coursesUnreadable: 1 })
  })
})

describe("telling which system a tab is", () => {
  it("tries the site's known system first, then what the address hints at", () => {
    expect(detectionOrder("https://school.brightspace.com", null)).toEqual(["brightspace", "canvas", "blackboard"])
    expect(detectionOrder("https://d2l.school.edu", null)[0]).toBe("brightspace")
    expect(detectionOrder("https://school.blackboard.com", null)[0]).toBe("blackboard")
    expect(detectionOrder("https://learn.school.edu", null)).toEqual(["canvas", "blackboard", "brightspace"])
    expect(detectionOrder("https://learn.school.edu", "brightspace")).toEqual(["brightspace", "canvas", "blackboard"])
  })
})
