import { describe, expect, it } from "vitest"
import { withAcademicCalendar } from "@/lib/academic-calendar"
import { toFindings } from "@/lib/announcements/schema"
import type { RecurringCommitment } from "@/lib/types"
import { calendarItemAsAssignment, classifyCalendarItem } from "./course-calendar"

describe("classifyCalendarItem", () => {
  it("exams and quizzes", () => {
    for (const title of ["Midterm Exam", "Exam 2", "Final Exam", "Final", "Unit 3 Test", "CSC215 midterm", "Mid-term"]) expect(classifyCalendarItem(title), title).toBe("exam")
    for (const title of ["Quiz 3", "Pop quiz", "Quizzes 4-5"]) expect(classifyCalendarItem(title), title).toBe("quiz")
  })

  it("days without class", () => {
    for (const title of ["No class", "No Class - Fall Break", "Class cancelled", "Lecture is canceled", "Cancelled: class", "No lecture today"]) {
      expect(classifyCalendarItem(title), title).toBe("no_class")
    }
  })

  it("everything else (including sessions about an exam) is just an event", () => {
    for (const title of ["Exam review session", "Midterm prep", "Final project due", "Final paper", "Office hours", "Guest speaker", "Test results posted", "Testing center tour"]) {
      expect(classifyCalendarItem(title), title).toBe("event")
    }
  })

  it("an exam becomes an assignment due when it starts, in the student's time zone", () => {
    const item = {
      provider: "canvas" as const,
      externalId: "501",
      courseExternalId: "215",
      title: "Midterm Exam",
      description: "Chapters 1-5",
      startsAt: "2026-10-15T14:00:00Z",
      endsAt: "2026-10-15T15:15:00Z",
      allDayDate: null,
      location: "Room 204",
      url: null,
    }
    expect(calendarItemAsAssignment(item, "exam", () => ({ dueDate: "2026-10-15", dueTime: "10:00" }))).toMatchObject({
      externalId: "event:501",
      type: "exam",
      dueDate: "2026-10-15",
      dueTime: "10:00",
      description: "Location: Room 204\n\nChapters 1-5",
    })
    expect(calendarItemAsAssignment({ ...item, startsAt: null, allDayDate: "2026-10-16" }, "exam", () => null)).toMatchObject({ dueDate: "2026-10-16", dueTime: null })
    expect(calendarItemAsAssignment({ ...item, startsAt: null }, "quiz", () => null)).toBeNull()
  })
})

describe("toFindings (the AI's answer, checked)", () => {
  const ids = new Set(["a1", "a2"])
  const today = "2026-10-05"
  const finding = (extra: Record<string, unknown>) => ({ announcementId: "a1", kind: "quiz", title: "Quiz 3", date: "2026-10-08", time: "10:00", quote: "Quiz 3 is on Thursday.", ...extra })

  it("keeps well-formed findings about a given announcement, from today to half a year ahead", () => {
    expect(toFindings({ findings: [finding({})] }, ids, today)).toEqual([
      { announcementId: "a1", kind: "quiz", title: "Quiz 3", date: "2026-10-08", time: "10:00", quote: "Quiz 3 is on Thursday." },
    ])
  })

  it("drops past or far-off dates, unknown announcements, bad dates and kinds, and duplicates; bad times become none", () => {
    const answer = {
      findings: [
        finding({ date: "2026-10-01" }),
        finding({ date: "2027-06-01" }),
        finding({ announcementId: "a9" }),
        finding({ date: "2026-02-30" }),
        finding({ kind: "party" }),
        finding({ title: "  " }),
        finding({ kind: "exam", title: "Midterm", date: "2026-10-20", time: "25:00" }),
        finding({ kind: "exam", title: "Midterm again", date: "2026-10-20", time: null }),
      ],
    }
    expect(toFindings(answer, ids, today)).toEqual([{ announcementId: "a1", kind: "exam", title: "Midterm", date: "2026-10-20", time: null, quote: "Quiz 3 is on Thursday." }])
    expect(toFindings("garbage", ids, today)).toEqual([])
  })
})

describe("cancelled classes", () => {
  const classTime = (courseId: string): RecurringCommitment => ({
    id: courseId,
    title: courseId,
    daysOfWeek: [2, 4],
    startTime: "10:00",
    endTime: "11:15",
    type: "class",
    startDate: "2026-08-25",
    endDate: "2026-12-20",
    courseId,
  })

  it("skip only their own course's class that day, along with the academic calendar's days off", () => {
    const [csc, psy] = withAcademicCalendar(
      [classTime("csc"), classTime("psy")],
      [{ id: "x", kind: "no_classes", title: "Fall break", term: "Fall 2026", startDate: "2026-10-12", endDate: "2026-10-13" }],
      [{ courseId: "csc", date: "2026-10-06" }]
    )
    expect(csc.skipDates).toEqual(["2026-10-06", "2026-10-12", "2026-10-13"])
    expect(psy.skipDates).toEqual(["2026-10-12", "2026-10-13"])
  })

  it("apply even when the school calendar has no days off", () => {
    const [csc, psy] = withAcademicCalendar([classTime("csc"), classTime("psy")], [], [{ courseId: "csc", date: "2026-10-06" }])
    expect(csc.skipDates).toEqual(["2026-10-06"])
    expect(psy).not.toHaveProperty("skipDates")
  })
})
