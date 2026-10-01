import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { loadAppData } from "../../../services/app-data"
import {
  BRIGHTSPACE_BASE as BASE,
  bsEnrollment,
  bsFolder,
  bsNotSubmitted,
  bsQuiz,
  bsSubmitted,
} from "../../../test-utils/fake-brightspace"
import { createTestDb } from "../../../test-utils/test-db"
import { importBrightspaceFromExtension } from "../../extension/brightspace-import"
import { listLmsConnections } from "../connections"
import { brightspaceCourseToLms, parseBrightspaceFolder, parseBrightspaceQuiz, submissionsStatus } from "./mapping"

// D2L Brightspace data in Quadernio: the mapping (brightspace/mapping.ts) and whole
// syncs through the browser extension's import, against a real Postgres.
// Fixtures: src/server/test-utils/fake-brightspace.ts.

const NOW = new Date("2026-09-23T12:00:00Z")

describe("mapping Brightspace data", () => {
  it("imports course offerings the student takes, with the semester's dates", () => {
    expect(
      brightspaceCourseToLms(
        bsEnrollment(6606, { Name: "Biology", Code: "BIO-101-01" }, {}, { StartDate: "2026-08-31T04:00:00.000Z", EndDate: "2026-12-19T04:59:00.000Z" }),
        BASE,
        "America/New_York"
      )
    ).toEqual({
      provider: "brightspace",
      externalId: "6606",
      courseCode: "BIO-101-01",
      courseName: "Biology",
      description: null,
      instructor: null,
      url: `${BASE}/d2l/home/6606`,
      termStart: "2026-08-31",
      termEnd: "2026-12-18",
    })
  })

  it("skips teaching roles, closed courses and other kinds of org units; keeps renamed student roles", () => {
    const course = (orgUnit: Record<string, unknown>, access: Record<string, unknown>) => brightspaceCourseToLms(bsEnrollment(1, orgUnit, access), BASE)
    expect(course({}, { LISRoles: ["urn:lti:role:ims/lis/Instructor"], ClasslistRoleName: "Instructor" })).toBeNull()
    expect(course({}, { LISRoles: [], ClasslistRoleName: "Teaching Assistant" })).toBeNull()
    expect(course({}, { LISRoles: [], ClasslistRoleName: "Learner" })).not.toBeNull()
    expect(course({}, { LISRoles: [], ClasslistRoleName: "Hawk Student" })).not.toBeNull()
    expect(course({}, { CanAccess: false })).toBeNull()
    expect(course({}, { IsActive: false })).toBeNull()
    expect(course({ Type: { Id: 5, Code: "Semester" } }, {})).toBeNull()
    expect(brightspaceCourseToLms({ OrgUnit: { Id: "not a number" } }, BASE)).toBeNull()
    expect(brightspaceCourseToLms("garbage", BASE)).toBeNull()
  })

  it("only keeps course links on the student's own Brightspace", () => {
    expect(brightspaceCourseToLms(bsEnrollment(1, { HomeUrl: "https://evil.example.com/d2l/home/1" }), BASE)?.url).toBeNull()
    expect(brightspaceCourseToLms(bsEnrollment(1, { HomeUrl: null }), BASE)?.url).toBe(`${BASE}/d2l/home/1`)
  })

  it("keeps visible folders and active quizzes", () => {
    expect(parseBrightspaceFolder(bsFolder(1))).not.toBeNull()
    expect(parseBrightspaceFolder(bsFolder(2, { IsHidden: true }))).toBeNull()
    expect(parseBrightspaceFolder(bsFolder(3, { Name: " " }))).toBeNull()
    expect(parseBrightspaceQuiz(bsQuiz(4))).not.toBeNull()
    expect(parseBrightspaceQuiz(bsQuiz(5, { IsActive: false }))).toBeNull()
  })

  it("submission status from the student's own records; unreadable is unknown", () => {
    expect(submissionsStatus([bsSubmitted])).toBe("submitted")
    expect(submissionsStatus([{ Status: 0, CompletionDate: "2026-09-20T15:00:00.000Z" }])).toBe("submitted")
    expect(submissionsStatus([{ Status: 3, Submissions: [] }])).toBe("graded")
    expect(submissionsStatus([bsNotSubmitted])).toBe("not_submitted")
    expect(submissionsStatus([])).toBe("not_submitted")
    expect(submissionsStatus([{ Status: "weird" }])).toBe("unknown")
    expect(submissionsStatus("nope")).toBe("unknown")
  })
})

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const sync = (user: string, payload: Record<string, unknown>) =>
  importBrightspaceFromExtension(t.db, user, { baseUrl: BASE, timeZone: "America/New_York", ...payload }, { now: NOW })

describe("syncing Brightspace into Quadernio", () => {
  it("imports courses, assignment folders and quizzes as normal courses and tasks", async () => {
    const user = await t.addUser("Alex")
    const result = await sync(user, {
      courses: [bsEnrollment(6606, { Name: "Biology", Code: "BIO101" })],
      folders: { "6606": [bsFolder(11), bsFolder(12, { DueDate: null }), bsFolder(13, { IsHidden: true })] },
      quizzes: { "6606": [bsQuiz(21)] },
      submissions: { "11": [bsNotSubmitted] },
    })
    expect(result).toMatchObject({ provider: "brightspace", coursesCreated: 1, assignmentsCreated: 2, assignmentsWithoutDueDate: 1, errors: [] })

    const data = await loadAppData(t.db, user)
    expect(data.courses).toEqual([
      expect.objectContaining({ code: "BIO101", name: "Biology", source: { provider: "brightspace", externalId: "6606", url: `${BASE}/d2l/home/6606` } }),
    ])
    const byTitle = Object.fromEntries(data.tasks.map((task) => [task.title, task]))
    expect(byTitle["Assignment 11"]).toMatchObject({
      dueDate: "2026-09-25",
      dueTime: "23:59",
      type: "assignment",
      source: {
        provider: "brightspace",
        externalId: "dropbox:11",
        url: `${BASE}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=11&ou=6606`,
        submissionStatus: "not_submitted",
      },
    })
    expect(byTitle["Quiz 21"]).toMatchObject({
      dueDate: "2026-09-30",
      dueTime: "12:00",
      type: "quiz",
      source: { provider: "brightspace", externalId: "quiz:21" },
    })
    // Unknown (quiz attempts aren't readable) is simply not recorded.
    expect(byTitle["Quiz 21"].source).not.toHaveProperty("submissionStatus")
    expect((await listLmsConnections(t.db, user)).find((c) => c.provider === "brightspace")).toMatchObject({ status: "connected" })
  })

  it("repeat syncs don't duplicate; work turned in in Brightspace is marked done", async () => {
    const user = await t.addUser("Alex")
    const payload = { courses: [bsEnrollment(6606)], folders: { "6606": [bsFolder(11)] }, submissions: { "11": [bsNotSubmitted] } }
    await sync(user, payload)
    expect(await sync(user, payload)).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsUpdated: 0 })

    await sync(user, { ...payload, submissions: { "11": [bsSubmitted] } })
    const [task] = (await loadAppData(t.db, user)).tasks
    expect(task).toMatchObject({ status: "completed", source: { submissionStatus: "submitted" } })
  })

  it("a dropbox folder and a quiz with the same number are two tasks", async () => {
    const user = await t.addUser("Alex")
    await sync(user, { courses: [bsEnrollment(6606)], folders: { "6606": [bsFolder(7)] }, quizzes: { "6606": [bsQuiz(7)] } })
    expect((await loadAppData(t.db, user)).tasks.map((task) => task.title).sort()).toEqual(["Assignment 7", "Quiz 7"])
  })

  it("a course the extension couldn't read is skipped, not emptied", async () => {
    const user = await t.addUser("Alex")
    await sync(user, { courses: [bsEnrollment(1), bsEnrollment(2)], folders: { "1": [bsFolder(11)], "2": [bsFolder(12)] } })
    const result = await sync(user, { courses: [bsEnrollment(1), bsEnrollment(2)], folders: { "1": [bsFolder(11)] } })
    expect(result).toMatchObject({ coursesSkipped: 1, assignmentsMissing: 0 })
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(2)
  })

  it("refuses data that isn't Brightspace's, and addresses that aren't public HTTPS", async () => {
    const user = await t.addUser("Alex")
    await expect(sync(user, { courses: "nope", folders: {} })).rejects.toThrow(/doesn't look like Brightspace data/)
    await expect(sync(user, { courses: [], folders: { "../x": [] } })).rejects.toThrow(/doesn't look like Brightspace data/)
    await expect(importBrightspaceFromExtension(t.db, user, { baseUrl: "http://localhost:9999", courses: [], folders: {} })).rejects.toThrow(
      /Brightspace address/
    )
  })
})
