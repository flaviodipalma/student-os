import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { MockSyllabusService } from "@/lib/ai/mock-syllabus-service"
import { sessionsAsCalendarItems } from "@/lib/calendar-items"
import { toMinutes } from "@/lib/events"
import { buildDayTimeline, createPlanner, type DailyPlan } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { commitmentsOn, scheduleBetween } from "@/lib/recurring"
import { toImportRequest } from "@/lib/syllabus/import"
import { processSyllabus } from "@/lib/syllabus/importer"
import { buildReviewDraft, blankReviewItem, type ReviewDraft } from "@/lib/syllabus/review"
import { makeTextPdf } from "@/lib/syllabus/test-utils/make-pdf"
import { eq } from "drizzle-orm"
import { courses as coursesTable, studySessions as sessionsTable, tasks as tasksTable } from "../db/schema"
import { DuplicateError, NotFoundError, toAppError } from "../errors"
import { createTestDb } from "../test-utils/test-db"
import { loadAppData, type AppData } from "./app-data"
import { createCourse, deleteCourse, getCourseForUser, updateCourse } from "./courses"
import { createEvent, deleteEvent, updateEvent } from "./events"
import { saveOnboardingDetails } from "./onboarding"
import { getPreferences, savePreferences } from "./preferences"
import { completeOnboarding } from "./profiles"
import { deleteRecurringCommitment, updateRecurringCommitment } from "./recurring-commitments"
import { createStudySession, deleteStudySession, updateStudySession } from "./study-sessions"
import { saveSyllabusImport } from "./syllabus"
import { createTask, deleteTask, getTaskForUser, updateTask } from "./tasks"

// The whole Student OS flow for one new student, through the real services, the
// real syllabus pipeline (PDF text -> extraction -> validation -> review ->
// import) and the real planner, on a real Postgres (PGlite):
//
//   sign up -> onboarding -> syllabus import -> courses & tasks -> calendar
//   -> planner -> dashboard -> complete work -> replan
//
// Fixed clock: Monday 2026-09-21, 8:00 AM.

const MONDAY = "2026-09-21"
const NOW = new Date(2026, 8, 21, 8, 0)
const TUESDAY = "2026-09-22"
const WEDNESDAY = "2026-09-23"
const THURSDAY = "2026-09-24"

let t: Awaited<ReturnType<typeof createTestDb>>
let alex: string
beforeAll(async () => {
  t = await createTestDb()
  alex = await t.addUser("Alex")
})
afterAll(() => t.close())

const load = () => loadAppData(t.db, alex)
// What the app does in the browser: saved data -> the planner (see PlannerProvider).
const plannerFor = (data: AppData, now = NOW) => createPlanner(plannerInputFor(data, now))
const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime)
const minutesOf = (plan: DailyPlan) =>
  plan.suggestions.reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)

const syllabusPdf = makeTextPdf([
  "CSC 215 — Computer Science",
  "Instructor: Professor Smith",
  "Fall 2026",
  "Project 1 — September 24",
  "Midterm Exam — October 14",
])

async function extractCsc215(): Promise<ReviewDraft> {
  const data = await load()
  const { extraction } = await processSyllabus(
    { name: "csc215.pdf", type: "application/pdf", size: syllabusPdf.length, bytes: syllabusPdf },
    { ai: new MockSyllabusService(), today: MONDAY }
  )
  return buildReviewDraft(extraction, data.courses, data.tasks)
}

describe("a new student, from sign-up to today's plan", () => {
  it("1. signs up and finishes onboarding: profile, preferences, soccer on weekdays", async () => {
    await saveOnboardingDetails(t.db, alex, {
      profile: { firstName: "Alex", lastName: "", schoolName: "", schoolDomain: null },
      preferences: { ...DEFAULT_STUDENT_PREFERENCES, maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60 },
      commitments: [
        { title: "Soccer", daysOfWeek: [1, 2, 3, 4, 5], startTime: "10:30", endTime: "13:00", type: "sports" },
      ],
    })
    await completeOnboarding(t.db, alex)
    const data = await load()
    expect(data.student).toMatchObject({ firstName: "Alex", onboardingCompleted: true })
    expect(data.preferences).toMatchObject({ maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60 })
    expect(commitmentsOn(data.recurringCommitments, MONDAY).map((c) => c.title)).toEqual(["Soccer"])
    expect(commitmentsOn(data.recurringCommitments, "2026-09-26")).toEqual([]) // Saturday
  })

  it("2. a cancelled syllabus import saves nothing", async () => {
    const draft = await extractCsc215()
    expect(toImportRequest(draft, false, { fileName: "csc215.pdf", itemsFound: 2 })).toBeNull()
    const data = await load()
    expect(data.courses).toEqual([])
    expect(data.tasks).toEqual([])
  })

  it("3. imports the CSC215 syllabus after reviewing and editing it", async () => {
    const draft = await extractCsc215()
    // What was extracted, and nothing invented: no estimate or priority stated.
    expect(draft.target).toEqual({ kind: "new" })
    expect(draft.course).toMatchObject({ code: "CSC215", name: "Computer Science", professor: "Professor Smith" })
    const project = draft.items.find((item) => item.title === "Project 1")!
    expect(project).toMatchObject({ dueDate: THURSDAY, type: "project", estimateMinutes: "", estimateFromSyllabus: false })

    // Review: rename, set priority and duration, remove the midterm, add a lab.
    const lab = { ...blankReviewItem(), title: "Lab 1", type: "lab" as const, dueDate: "2026-09-30", description: "Bring a laptop" }
    const reviewed: ReviewDraft = {
      ...draft,
      items: [
        { ...project, title: "CSC215 Project", priority: "high", estimateMinutes: "120", description: "Linked lists" },
        lab,
      ],
    }
    const saved = await saveSyllabusImport(t.db, alex, toImportRequest(reviewed, true, { fileName: "csc215.pdf", itemsFound: 2 })!)

    expect(saved.createdCourse).toBe(true)
    const data = await load()
    expect(data.courses).toEqual([
      expect.objectContaining({ code: "CSC215", name: "Computer Science", professor: "Professor Smith" }),
    ])
    const course = data.courses[0]
    expect(data.tasks.map((task) => task.title).sort()).toEqual(["CSC215 Project", "Lab 1"])
    expect(data.tasks.find((task) => task.title === "CSC215 Project")).toMatchObject({
      courseId: course.id,
      dueDate: THURSDAY, // date-only: exactly as extracted, no time-zone shift
      priority: "high",
      estimateMinutes: 120,
      description: "Linked lists",
      status: "not_started",
    })
    expect(data.tasks.find((task) => task.title === "Lab 1")).toMatchObject({ description: "Bring a laptop" })
    expect(data.tasks.some((task) => task.title === "Midterm Exam")).toBe(false) // removed in review
  })

  it("4. importing the same syllabus again doesn't duplicate anything", async () => {
    const draft = await extractCsc215()
    const data = await load()
    // Recognised: goes into the existing course…
    expect(draft.target).toEqual({ kind: "existing", courseId: data.courses[0].id })
    // …the already-imported project starts unselected; the midterm (removed last time) is offered again.
    expect(draft.items.filter((item) => item.selected).map((item) => item.title)).toEqual(["Midterm Exam"])

    // Creating the course a second time is refused rather than duplicated.
    const asNew = toImportRequest({ ...draft, target: { kind: "new" } }, true, { fileName: "csc215.pdf", itemsFound: 2 })!
    await expect(saveSyllabusImport(t.db, alex, asNew)).rejects.toBeInstanceOf(DuplicateError)

    // A retried request (e.g. the connection dropped after saving) is saved once.
    const request = toImportRequest(draft, true, { fileName: "csc215.pdf", itemsFound: 2 })!
    const first = await saveSyllabusImport(t.db, alex, request)
    const retry = await saveSyllabusImport(t.db, alex, request)
    expect(retry.tasks.map((task) => task.id)).toEqual(first.tasks.map((task) => task.id))
    const after = await load()
    expect(after.courses).toHaveLength(1)
    expect(after.tasks.filter((task) => task.title === "Midterm Exam")).toHaveLength(1)
    expect(after.tasks.filter((task) => task.title === "CSC215 Project")).toHaveLength(1)
  })

  it("5. adds PSY101 and BIO110 with their work, and a CSC215 class today", async () => {
    const psy = await createCourse(t.db, alex, { code: "PSY101", name: "Psychology", professor: "", description: "" })
    const bio = await createCourse(t.db, alex, { code: "BIO110", name: "Biology", professor: "", description: "" })
    const base = { description: "", status: "not_started" as const }
    await createTask(t.db, alex, { ...base, courseId: psy.id, title: "PSY101 Reading", type: "reading", dueDate: TUESDAY, priority: "medium", estimateMinutes: 60 })
    await createTask(t.db, alex, { ...base, courseId: bio.id, title: "BIO110 Exam", type: "exam", dueDate: WEDNESDAY, priority: "critical", estimateMinutes: 180 })
    const csc = (await load()).courses.find((c) => c.code === "CSC215")!
    await createEvent(t.db, alex, { title: "CSC215 class", date: MONDAY, startTime: "14:00", endTime: "15:15", type: "class", courseId: csc.id })

    const data = await load()
    const courseOf = (title: string) => data.courses.find((c) => c.id === data.tasks.find((task) => task.title === title)!.courseId)!.code
    expect(courseOf("PSY101 Reading")).toBe("PSY101")
    expect(courseOf("BIO110 Exam")).toBe("BIO110")
    expect(courseOf("CSC215 Project")).toBe("CSC215")
  })

  it("6. today's plan works around soccer and class, puts urgent work first, and stays within limits", async () => {
    const data = await load()
    const plan = plannerFor(data).planFor(MONDAY)
    const soccer = { startTime: "10:30", endTime: "13:00" }
    const csClass = { startTime: "14:00", endTime: "15:15" }

    expect(plan.status).toBe("ok")
    expect(plan.suggestions.length).toBeGreaterThan(0)
    for (const s of plan.suggestions) {
      expect(overlaps(s, soccer)).toBe(false)
      expect(overlaps(s, csClass)).toBe(false)
      expect(toMinutes(s.endTime) - toMinutes(s.startTime)).toBeLessThanOrEqual(60)
    }
    const sorted = [...plan.suggestions].sort((a, b) => a.startTime.localeCompare(b.startTime))
    for (let i = 1; i < sorted.length; i++) expect(overlaps(sorted[i], sorted[i - 1])).toBe(false)
    expect(minutesOf(plan)).toBeLessThanOrEqual(240)

    // Urgent work: the critical exam (due in 2 days) ranks first, and the reading
    // due tomorrow gets all of its hour today.
    const title = (taskId: string) => data.tasks.find((task) => task.id === taskId)!.title
    expect(plan.ranked[0].task.title).toBe("BIO110 Exam")
    expect(plan.suggestions.find((s) => title(s.taskId) === "BIO110 Exam")!.reasons).toContain("Critical priority")
    const reading = plan.suggestions.filter((s) => title(s.taskId) === "PSY101 Reading")
    expect(reading.reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)).toBe(60)
    expect(reading[0].reasons[0]).toBe("Due tomorrow")
  })

  it("7. the Dashboard shows the same plan, with soccer, class and study in order", async () => {
    const data = await load()
    const planner = plannerFor(data)
    const plan = planner.planFor(MONDAY)
    // Planner page and Dashboard ask the same planner for the same date: the same object.
    expect(planner.planFor(MONDAY)).toBe(plan)

    // What the Dashboard's "Today's plan" renders (TodaySchedule).
    const items = sessionsAsCalendarItems(data.studySessions, data.tasks, data.courses)
    const today = scheduleBetween([...data.events, ...items], data.recurringCommitments, MONDAY, MONDAY)
    const timeline = buildDayTimeline(plan, today).filter((item) => item.kind === "event" || item.kind === "session")
    const labels = timeline.map((item) => (item.kind === "event" ? item.event.title : "study"))
    expect(labels).toContain("Soccer")
    expect(labels).toContain("CSC215 class")
    expect(labels.filter((label) => label === "study")).toHaveLength(plan.suggestions.length)
    const starts = timeline.map((item) => item.start)
    expect([...starts].sort()).toEqual(starts)
  })

  it("8. completing a study session counts as progress; the task stays open until marked done", async () => {
    let data = await load()
    const project = data.tasks.find((task) => task.title === "CSC215 Project")!
    // The student works 60 minutes on the project this morning and marks it done.
    await createStudySession(t.db, alex, { taskId: project.id, date: MONDAY, startTime: "08:00", endTime: "09:00", status: "completed" })
    data = await load()
    expect(data.tasks.find((task) => task.id === project.id)!.status).toBe("not_started")

    const plan = plannerFor(data).planFor(MONDAY)
    const scored = plan.ranked.find((s) => s.task.id === project.id)
    expect(scored?.remainingMinutes).toBe(60)
    expect(scored?.factors.map((f) => f.key)).toContain("in-progress")
    // Nothing is planned on top of the completed session.
    for (const s of plan.suggestions) expect(overlaps(s, { startTime: "08:00", endTime: "09:00" })).toBe(false)
  })

  it("9. re-running the planner, or accepting a suggestion, never duplicates work", async () => {
    let data = await load()
    const first = plannerFor(data).planFor(MONDAY)
    expect(plannerFor(data).planFor(MONDAY)).toEqual(first) // same data, same plan

    // Accept the first suggestion: it becomes a scheduled study session.
    const accepted = first.suggestions[0]
    await createStudySession(t.db, alex, { taskId: accepted.taskId, date: MONDAY, startTime: accepted.startTime, endTime: accepted.endTime, status: "scheduled" })
    data = await load()
    const next = plannerFor(data).planFor(MONDAY)
    expect(next.existingSessions.some((s) => s.startTime === accepted.startTime && s.status === "scheduled")).toBe(true)
    expect(next.suggestions.some((s) => overlaps(s, accepted))).toBe(false)
    expect(next.studyMinutes).toBeLessThanOrEqual(first.studyMinutes)
    expect(data.studySessions.filter((s) => s.startTime === accepted.startTime && s.date === MONDAY)).toHaveLength(1)
  })

  it("10. task and preference changes are used by the next plan", async () => {
    let data = await load()
    const reading = data.tasks.find((task) => task.title === "PSY101 Reading")!
    await updateTask(t.db, alex, reading.id, { status: "completed" })
    await savePreferences(t.db, alex, { ...data.preferences, maxStudyMinutesPerDay: 60 })
    data = await load()

    const plan = plannerFor(data).planFor(MONDAY)
    expect(plan.ranked.some((s) => s.task.id === reading.id)).toBe(false) // completed: not planned
    expect(plan.studyLimit).toBe(60)
    const booked = plan.studyMinutes - minutesOf(plan)
    expect(minutesOf(plan)).toBeLessThanOrEqual(Math.max(0, 60 - booked))

    // Moving a due date moves the work: the exam due in a week is no longer urgent.
    const exam = data.tasks.find((task) => task.title === "BIO110 Exam")!
    await updateTask(t.db, alex, exam.id, { dueDate: "2026-09-28", priority: "low" })
    await savePreferences(t.db, alex, { ...data.preferences, maxStudyMinutesPerDay: 240 })
    const later = plannerFor(await load()).planFor(MONDAY)
    expect(later.ranked.find((s) => s.task.id === exam.id)!.factors[0].label).toBe("Due in 7 days")
  })

  it("11. deleting a course removes its tasks and study sessions, and nothing is left dangling", async () => {
    const before = await load()
    const csc = before.courses.find((c) => c.code === "CSC215")!
    const cscTaskIds = before.tasks.filter((task) => task.courseId === csc.id).map((task) => task.id)
    expect(cscTaskIds.length).toBeGreaterThan(0)

    await deleteCourse(t.db, alex, csc.id)
    const after = await load()
    expect(after.courses.some((c) => c.id === csc.id)).toBe(false)
    expect(await t.db.select().from(tasksTable).where(eq(tasksTable.courseId, csc.id))).toEqual([])
    const orphanSessions = (await t.db.select().from(sessionsTable)).filter((s) => cscTaskIds.includes(s.taskId))
    expect(orphanSessions).toEqual([])
    // The class event stays on the calendar, just no longer linked to the deleted course.
    expect(after.events.find((e) => e.title === "CSC215 class")?.courseId).toBeUndefined()
    // And the planner still works on what's left.
    expect(plannerFor(after).planFor(MONDAY).ranked.every((s) => s.task.courseId !== csc.id)).toBe(true)
  })
})

// ---------------------------------------------------------------------------

describe("another student can't reach Alex's data (service layer)", () => {
  it("every kind of record is private", async () => {
    const sam = await t.addUser("Sam")
    const data = await load()
    const course = data.courses[0]
    const task = data.tasks[0]
    const event = data.events[0]
    const commitment = data.recurringCommitments[0]
    const session = await createStudySession(t.db, alex, { taskId: task.id, date: TUESDAY, startTime: "16:00", endTime: "17:00", status: "scheduled" })

    // Sam's own load shows none of it.
    const sams = await loadAppData(t.db, sam)
    expect(sams.courses).toEqual([])
    expect(sams.tasks).toEqual([])
    expect(sams.events).toEqual([])
    expect(sams.studySessions).toEqual([])
    expect(sams.recurringCommitments).toEqual([])
    expect(sams.preferences).toEqual(DEFAULT_STUDENT_PREFERENCES)
    // Alex's saved preferences stay his (Sam can only ever save his own row).
    await savePreferences(t.db, sam, { ...DEFAULT_STUDENT_PREFERENCES, breakMinutes: 30 })
    expect((await getPreferences(t.db, alex)).breakMinutes).toBe(DEFAULT_STUDENT_PREFERENCES.breakMinutes)

    // Reading, changing or deleting by id: always "not found", never someone else's data.
    const refused = [
      getCourseForUser(t.db, sam, course.id),
      updateCourse(t.db, sam, course.id, { name: "Hacked" }),
      deleteCourse(t.db, sam, course.id),
      getTaskForUser(t.db, sam, task.id),
      updateTask(t.db, sam, task.id, { title: "Hacked" }),
      deleteTask(t.db, sam, task.id),
      updateEvent(t.db, sam, event.id, { title: "Hacked" }),
      deleteEvent(t.db, sam, event.id),
      updateRecurringCommitment(t.db, sam, commitment.id, { title: "Hacked" }),
      deleteRecurringCommitment(t.db, sam, commitment.id),
      updateStudySession(t.db, sam, session.id, { status: "completed" }),
      deleteStudySession(t.db, sam, session.id),
      // Attaching his own records to Alex's course or task.
      createTask(t.db, sam, { courseId: course.id, title: "x", description: "", type: "other", dueDate: TUESDAY, priority: "low", estimateMinutes: 30, status: "not_started" }),
      createStudySession(t.db, sam, { taskId: task.id, date: TUESDAY, startTime: "09:00", endTime: "10:00", status: "scheduled" }),
      // Importing a syllabus into Alex's course.
      saveSyllabusImport(t.db, sam, {
        course: { kind: "existing", courseId: course.id },
        tasks: [{ id: crypto.randomUUID(), title: "x", description: "", type: "other", dueDate: TUESDAY, priority: "low", estimateMinutes: 30, status: "not_started" }],
        source: { fileName: "x.pdf", itemsFound: 1 },
      }),
    ]
    for (const attempt of refused) await expect(attempt).rejects.toBeInstanceOf(NotFoundError)

    // A replayed import with Alex's task ids doesn't hand Sam Alex's tasks either.
    await expect(
      saveSyllabusImport(t.db, sam, {
        course: { kind: "existing", courseId: course.id },
        tasks: [{ ...task, id: task.id }],
        source: { fileName: "x.pdf", itemsFound: 1 },
      })
    ).rejects.toBeInstanceOf(NotFoundError)

    // Nothing of Alex's changed.
    const again = await load()
    expect(again.courses).toEqual(data.courses)
    expect(again.tasks.map((x) => x.title)).toEqual(data.tasks.map((x) => x.title))
    expect(again.events).toEqual(data.events)
    expect(again.recurringCommitments).toEqual(data.recurringCommitments)
    expect((await t.db.select().from(coursesTable).where(eq(coursesTable.userId, sam)))).toEqual([])
  })
})

// ---------------------------------------------------------------------------

describe("failures don't break the app or leak details", () => {
  it("database problems become a safe, friendly message", () => {
    const connectionLost = Object.assign(new Error("connect ECONNREFUSED 10.0.0.5:6543 password=hunter2"), { code: "ECONNREFUSED" })
    const error = toAppError(connectionLost)
    expect(error.code).toBe("database")
    expect(error.message).toBe("We couldn't reach the database. Please try again in a moment.")
    expect(error.message).not.toMatch(/ECONN|6543|password/)
    // Constraint violations explain the problem without SQL.
    expect(toAppError(Object.assign(new Error("duplicate key value violates…"), { code: "23505" })).message).toBe("That already exists.")
  })

  it("the planner copes with incomplete or odd data", () => {
    const task = {
      id: "t1",
      courseId: "missing-course",
      title: "No estimate",
      description: "",
      type: "other" as const,
      dueDate: TUESDAY,
      priority: "medium" as const,
      estimateMinutes: Number.NaN,
      status: "not_started" as const,
    }
    const plan = createPlanner({
      tasks: [task],
      events: [{ id: "e1", title: "Backwards", date: MONDAY, startTime: "15:00", endTime: "14:00", type: "class" }],
      now: NOW,
    }).planFor(MONDAY)
    expect(plan.suggestions.length).toBeGreaterThan(0) // planned with the fallback estimate
    expect(plan.warnings.some((w) => w.kind === "no-estimate")).toBe(true)
  })
})
