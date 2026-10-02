import { and, eq } from "drizzle-orm"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { announcementFindings, classCancellations, externalCalendarEvents, lmsAnnouncements } from "../../db/schema"
import { acceptFinding, dismissFinding, listAnnouncementFindings, listClassCancellations, removeClassCancellation } from "../../services/announcements"
import { loadAppData } from "../../services/app-data"
import { listRecurringCommitments, setClassTimes } from "../../services/recurring-commitments"
import { BRIGHTSPACE_BASE, bsEnrollment } from "../../test-utils/fake-brightspace"
import { createTestDb } from "../../test-utils/test-db"
import { resetRateLimits } from "../../rate-limit"
import { importBrightspaceFromExtension } from "../extension/brightspace-import"
import { importCanvasFromExtension } from "../extension/canvas-import"

// Course calendars and announcements in a sync: exams and quizzes on the calendar
// become tasks, "no class" days cancel that course's class, other items go on the
// calendar, and new announcements are read once (FAKE AI: ANNOUNCEMENT_AI_PROVIDER=mock,
// which only understands written-out dates) into suggestions the student accepts.
// TEST FIXTURES shaped after the Canvas and Brightspace APIs; no LMS is contacted.

const BASE = "https://school.instructure.com"
const NOW = new Date("2026-10-05T16:00:00Z") // Monday, Oct 5, noon in New York
const course = { id: 215, name: "Data Structures", course_code: "CSC215" }
const event = (id: number, title: string, extra: Record<string, unknown> = {}) => ({
  id,
  title,
  start_at: "2026-10-15T14:00:00Z",
  end_at: "2026-10-15T15:15:00Z",
  all_day: false,
  html_url: `${BASE}/calendar?event_id=${id}`,
  ...extra,
})
const announcement = (id: number, title: string, message: string, posted = "2026-10-05T13:00:00Z") => ({ id, title, message: `<p>${message}</p>`, posted_at: posted })

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  vi.stubEnv("ANNOUNCEMENT_AI_PROVIDER", "mock")
  resetRateLimits()
})
afterEach(() => {
  vi.unstubAllEnvs()
  return t.close()
})

const sync = (user: string, extra: Record<string, unknown>, now = NOW) =>
  importCanvasFromExtension(t.db, user, { baseUrl: BASE, timeZone: "America/New_York", courses: [course], assignments: { "215": [] }, ...extra }, { now })

describe("course calendars", () => {
  it("exams and quizzes become tasks; 'no class' cancels the class; other items go on the calendar", async () => {
    const user = await t.addUser("Alex")
    const result = await sync(user, {
      events: {
        "215": [
          event(501, "Midterm Exam", { location_name: "Room 204" }),
          event(502, "Quiz 2", { start_at: "2026-10-08T14:00:00Z", end_at: "2026-10-08T14:20:00Z" }),
          event(503, "Exam review session", { start_at: "2026-10-14T22:00:00Z", end_at: "2026-10-14T23:00:00Z" }),
          event(504, "No class - Fall Break", { all_day: true, all_day_date: "2026-10-13", start_at: "2026-10-13T04:00:00Z", end_at: "2026-10-14T04:00:00Z" }),
        ],
      },
      announcements: { "215": [] },
    })
    expect(result).toMatchObject({ assignmentsCreated: 2, calendarEventsAdded: 1, classesCancelled: 1, suggestions: 0 })

    const data = await loadAppData(t.db, user)
    expect(data.tasks.map((task) => [task.title, task.type, task.dueDate, task.dueTime ?? null]).sort()).toEqual([
      ["Midterm Exam", "exam", "2026-10-15", "10:00"],
      ["Quiz 2", "quiz", "2026-10-08", "10:00"],
    ])
    expect(data.externalEvents).toEqual([expect.objectContaining({ source: "canvas", title: "CSC215 · Exam review session" })])
    expect(data.classCancellations).toEqual([expect.objectContaining({ date: "2026-10-13", source: "calendar" })])

    // The course's class times skip that day.
    await setClassTimes(t.db, user, data.courses[0].id, [{ daysOfWeek: [2, 4], startTime: "10:00", endTime: "11:15", startDate: "2026-08-25", endDate: "2026-12-20" }])
    const [classes] = await listRecurringCommitments(t.db, user)
    expect(classes.skipDates).toContain("2026-10-13")

    // Syncing again changes nothing (no duplicates).
    expect(await sync(user, { events: { "215": [event(501, "Midterm Exam"), event(503, "Exam review session", { start_at: "2026-10-14T22:00:00Z", end_at: "2026-10-14T23:00:00Z" })] } })).toMatchObject({
      assignmentsCreated: 0,
      calendarEventsAdded: 0,
      classesCancelled: 0,
    })
  })

  it("an older extension (no calendar or announcements sent) changes nothing about them", async () => {
    const user = await t.addUser("Alex")
    const result = await sync(user, {})
    expect(result).not.toHaveProperty("calendarEventsAdded")
    expect(await t.db.select().from(externalCalendarEvents)).toEqual([])
  })
})

describe("announcements", () => {
  const posts = {
    "215": [
      announcement(601, "Quiz Thursday", "Quiz 3 is on 2026-10-08 at 10:00. Bring a pencil."),
      announcement(602, "No class", "No class on 2026-10-06. Enjoy the day."),
      announcement(603, "Welcome", "Great job on the first project!"),
    ],
  }

  it("new ones become suggestions; nothing changes until accepted; each is read only once", async () => {
    const user = await t.addUser("Alex")
    expect(await sync(user, { announcements: posts })).toMatchObject({ suggestions: 2 })
    const findings = await listAnnouncementFindings(t.db, user, NOW)
    expect(findings.map((finding) => [finding.kind, finding.title, finding.date, finding.time ?? null, finding.quote])).toEqual([
      ["no_class", "No class", "2026-10-06", null, "No class on 2026-10-06."],
      ["quiz", "Quiz 3", "2026-10-08", "10:00", "Quiz 3 is on 2026-10-08 at 10:00."],
    ])
    // Nothing in the plan yet.
    expect((await loadAppData(t.db, user)).tasks).toEqual([])
    expect(await listClassCancellations(t.db, user)).toEqual([])
    // Recorded as read: ids and titles only, never the text.
    const recorded = await t.db.select().from(lmsAnnouncements)
    expect(recorded.map((row) => row.externalId).sort()).toEqual(["601", "602", "603"])
    expect(JSON.stringify(recorded)).not.toMatch(/pencil|Great job/)

    // The next sync doesn't read them again or repeat the suggestions.
    expect(await sync(user, { announcements: posts })).toMatchObject({ suggestions: 0 })
    expect(await t.db.select().from(announcementFindings)).toHaveLength(2)
  })

  it("accepting: a quiz becomes a task; 'no class' cancels that class, and Undo brings it back", async () => {
    const user = await t.addUser("Alex")
    await sync(user, { announcements: posts })
    const [noClass, quiz] = await listAnnouncementFindings(t.db, user, NOW)

    const accepted = await acceptFinding(t.db, user, quiz.id)
    expect(accepted.task).toMatchObject({ title: "Quiz 3", type: "quiz", dueDate: "2026-10-08", dueTime: "10:00", notes: 'From an announcement: "Quiz 3 is on 2026-10-08 at 10:00."' })
    await expect(acceptFinding(t.db, user, quiz.id)).rejects.toThrow(/doesn't exist/)

    const cancelled = await acceptFinding(t.db, user, noClass.id)
    expect(cancelled.cancellation).toMatchObject({ date: "2026-10-06", source: "announcement" })
    expect(await listAnnouncementFindings(t.db, user, NOW)).toEqual([])

    const undone = await removeClassCancellation(t.db, user, cancelled.cancellation!.id)
    expect(undone.finding).toMatchObject({ id: noClass.id, status: "pending" })
    expect(await listClassCancellations(t.db, user)).toEqual([])
  })

  it("dismissing hides a suggestion; another student can't touch it", async () => {
    const user = await t.addUser("Alex")
    const other = await t.addUser("Sam")
    await sync(user, { announcements: posts })
    const [first] = await listAnnouncementFindings(t.db, user, NOW)
    await expect(acceptFinding(t.db, other, first.id)).rejects.toThrow(/doesn't exist/)
    await expect(dismissFinding(t.db, other, first.id)).rejects.toThrow(/doesn't exist/)
    await dismissFinding(t.db, user, first.id)
    expect(await listAnnouncementFindings(t.db, user, NOW)).toHaveLength(1)
  })

  it("no duplicate suggestions for a quiz that's already a task (e.g. from the calendar)", async () => {
    const user = await t.addUser("Alex")
    await sync(user, {
      events: { "215": [event(502, "Quiz 3", { start_at: "2026-10-08T14:00:00Z", end_at: "2026-10-08T14:20:00Z" })] },
      announcements: { "215": [posts["215"][0]] },
    })
    expect(await listAnnouncementFindings(t.db, user, NOW)).toEqual([])
  })

  it("when the AI can't be reached, nothing is recorded, so the next sync tries again", async () => {
    const user = await t.addUser("Alex")
    const down = { "215": [announcement(701, "Exam", "AI DOWN. The midterm is on 2026-10-20.")] }
    expect(await sync(user, { announcements: down })).toMatchObject({ suggestions: 0 })
    expect(await t.db.select().from(lmsAnnouncements)).toEqual([])
    const back = { "215": [announcement(701, "Exam", "The midterm is on 2026-10-20.")] }
    expect(await sync(user, { announcements: back })).toMatchObject({ suggestions: 1 })
  })

  it("Brightspace D2L news works the same way", async () => {
    const user = await t.addUser("Alex")
    const result = await importBrightspaceFromExtension(
      t.db,
      user,
      {
        baseUrl: BRIGHTSPACE_BASE,
        timeZone: "America/New_York",
        courses: [bsEnrollment(6606, { Name: "CS 305 01 - Advanced Computing", Code: "CS-305-01" })],
        folders: { "6606": [] },
        events: { "6606": [{ CalendarEventId: 901, Title: "Midterm Exam", StartDateTime: "2026-10-15T14:00:00.000Z", EndDateTime: "2026-10-15T15:15:00.000Z" }] },
        announcements: { "6606": [{ Id: 1001, Title: "Quiz", Body: { Text: "Quiz 2 is on 2026-10-09.", Html: "" }, StartDate: "2026-10-05T13:00:00.000Z" }] },
      },
      { now: NOW }
    )
    expect(result).toMatchObject({ assignmentsCreated: 1, suggestions: 1 })
    const [finding] = await listAnnouncementFindings(t.db, user, NOW)
    expect(finding).toMatchObject({ kind: "quiz", date: "2026-10-09" })
    const rows = await t.db.select().from(announcementFindings).where(and(eq(announcementFindings.userId, user), eq(announcementFindings.status, "pending")))
    expect(rows).toHaveLength(1)
    expect(await t.db.select().from(classCancellations)).toEqual([])
  })
})
