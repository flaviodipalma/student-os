import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { toMinutes } from "@/lib/events"
import { addDays, toDateKey } from "@/lib/format"
import { generateNotifications } from "@/lib/notifications/generate"
import { createPlanner, dayAvailability, whatNow, type DailyPlan } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_NOTIFICATION_PREFERENCES } from "@/lib/preferences"
import { scheduleBetween } from "@/lib/recurring"
import { instantAt } from "@/lib/time-zone"
import type { CalendarEvent, Task } from "@/lib/types"
import { externalCalendarEvents, studySessions as sessionsTable, tasks as tasksTable } from "../db/schema"
import { createTestDb } from "../test-utils/test-db"
import { loadAppData, type AppData } from "./app-data"
import { createCourse, deleteCourse } from "./courses"
import { createEvent, updateEvent } from "./events"
import { saveOnboardingDetails } from "./onboarding"
import { completeOnboarding } from "./profiles"
import { createStudySession } from "./study-sessions"
import { createTask, deleteTask, updateTask } from "./tasks"
import { listNotifications, syncNotifications } from "./notifications"

// Product audit: one realistic student ("Maya", a sophomore in New York) through
// the real services, database and Planner. Each scenario from the audit (A-J
// for the Planner, 1-7 for "What should I do now?") is checked against what the
// app itself computes; nothing here re-implements planning.
//
// "Now" is Thursday 2026-09-24, 2:30 PM New York time (the Planner works in the
// student's wall-clock time; external events are real instants).

const NY = "America/New_York"
const TODAY = "2026-09-24"
const at = (date: string, time: string) => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)))
const NOW = at(TODAY, "14:30")

let t: Awaited<ReturnType<typeof createTestDb>>
let maya: string
const id: Record<string, string> = {}

beforeAll(async () => {
  t = await createTestDb()
  maya = await t.addUser("Maya")
  await saveOnboardingDetails(t.db, maya, {
    profile: { firstName: "Maya", lastName: "Lopez", academicTerm: "Fall 2026", academicYear: "sophomore" },
    preferences: { studyStart: "08:00", studyEnd: "23:00", maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60, breakMinutes: 10 },
    commitments: [
      // Classes and soccer as weekly commitments.
      { title: "CSC215 Lecture", daysOfWeek: [1, 3, 5], startTime: "09:00", endTime: "09:50", type: "class" },
      { title: "MATH221 Lecture", daysOfWeek: [2, 4], startTime: "11:00", endTime: "12:15", type: "class" },
      { title: "Soccer Practice", daysOfWeek: [1, 2, 3, 4], startTime: "16:00", endTime: "18:00", type: "sports" },
      { title: "Campus job", daysOfWeek: [2], startTime: "19:00", endTime: "21:00", type: "work" },
    ],
  })
  await completeOnboarding(t.db, maya)
  const course = async (code: string, name: string) => (id[code] = (await createCourse(t.db, maya, { code, name, professor: "", description: "" })).id)
  await course("CSC215", "Data Structures")
  await course("MATH221", "Calculus II")
  await course("PSY101", "Intro to Psychology")
  await course("ENG102", "Composition")
  await course("BIO110", "Biology")
  const task = async (key: string, input: Partial<Task> & Pick<Task, "courseId" | "title" | "dueDate">) =>
    (id[key] = (await createTask(t.db, maya, { description: "", type: "assignment", priority: "medium", estimateMinutes: 60, status: "not_started", ...input })).id)
  await task("project", { courseId: id.CSC215, title: "Project 2: Hash Tables", type: "project", dueDate: "2026-09-28", dueTime: "23:59", priority: "high", estimateMinutes: 360, status: "in_progress" })
  await task("exam", { courseId: id.MATH221, title: "Midterm Exam", type: "exam", dueDate: "2026-09-30", dueTime: "10:00", priority: "critical", estimateMinutes: 240 })
  await task("reading", { courseId: id.PSY101, title: "Chapter 4 Reading", type: "reading", dueDate: "2026-09-25", estimateMinutes: 45 })
  await task("essay", { courseId: id.ENG102, title: "Essay Draft", type: "paper", dueDate: "2026-09-22", priority: "high", estimateMinutes: 120 })
  await task("lab", { courseId: id.BIO110, title: "Lab Report 3", type: "lab", dueDate: "2026-10-06", priority: "low", estimateMinutes: 90 })
  await task("pset", { courseId: id.MATH221, title: "Problem Set 3", dueDate: TODAY, dueTime: "23:59", estimateMinutes: 60 })
  await task("peer", { courseId: id.ENG102, title: "Peer Review", dueDate: "2026-09-21", status: "completed" })
  // An hour of the project already done yesterday.
  await createStudySession(t.db, maya, { taskId: id.project, date: "2026-09-23", startTime: "19:00", endTime: "20:00", status: "completed" })
  // A personal event today, and external calendars (as their syncs store them).
  id.dinner = (await createEvent(t.db, maya, { title: "Dinner with family", date: TODAY, startTime: "18:30", endTime: "19:30", type: "personal" })).id
  const ext = (source: "canvas" | "blackboard" | "google" | "outlook", externalId: string, title: string, date: string, start: string, end: string) =>
    t.db.insert(externalCalendarEvents).values({ userId: maya, source, externalId, title, startsAt: instantAt(date, start, NY), endsAt: instantAt(date, end, NY) })
  await ext("canvas", "calendar-event-1", "CSC215 Office Hours", "2026-09-25", "13:00", "14:00")
  await ext("blackboard", "bb-1", "BIO110 Review Session", "2026-09-25", "10:00", "11:00")
  await ext("google", "dentist@google.com", "Dentist", "2026-09-25", "15:00", "16:00")
  await ext("outlook", "AAMk-1", "Club meeting", "2026-09-26", "11:00", "12:00")
})
afterAll(() => t.close())

// What the app computes (the same path as the PlannerProvider and the Dashboard).
type World = { data: AppData; events: CalendarEvent[]; planner: ReturnType<typeof createPlanner> }
async function world(now = NOW): Promise<World> {
  const data = await loadAppData(t.db, maya)
  const input = plannerInputFor({ ...data, timeZone: NY }, now)
  return { data, events: input.events, planner: createPlanner(input) }
}
const now = (w: World, instant = NOW) => {
  const today = toDateKey(instant)
  return whatNow({ planner: w.planner, now: instant, today, schedule: scheduleBetween(w.events, w.data.recurringCommitments, today, today), events: w.events, tasks: w.data.tasks })
}
const overlaps = (a: { startTime: string; endTime: string }, b: { startTime: string; endTime: string }) =>
  toMinutes(a.startTime) < toMinutes(b.endTime) && toMinutes(b.startTime) < toMinutes(a.endTime)
const fixedOn = (w: World, date: string) => scheduleBetween(w.events, w.data.recurringCommitments, date, date).filter((e) => e.type !== "study")
const minutes = (plan: DailyPlan) => plan.suggestions.reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0)

describe("the Planner, with Maya's real week", () => {
  it("A. plenty of time: a realistic plan, never every free minute, within her daily limit", async () => {
    const w = await world()
    for (let i = 0; i < 7; i++) {
      const date = addDays(TODAY, i)
      const plan = w.planner.planFor(date)
      const free = dayAvailability(date, w.events, w.data.recurringCommitments, NOW, w.planner.settings)
      expect(plan.studyMinutes).toBeLessThanOrEqual(240)
      if (free.freeMinutes > 0) expect(minutes(plan)).toBeLessThan(free.freeMinutes)
    }
  })

  it("B/J. never on top of classes, soccer, work, dinner or Canvas / Blackboard / Google / Outlook events", async () => {
    const w = await world()
    for (let i = 0; i < 14; i++) {
      const date = addDays(TODAY, i)
      const fixed = fixedOn(w, date)
      for (const session of w.planner.planFor(date).suggestions) {
        for (const event of fixed) expect(overlaps(session, event), `${date} ${session.startTime} vs ${event.title}`).toBe(false)
      }
    }
    // The external events really are in the busy time.
    const tomorrow = fixedOn(w, "2026-09-25").map((e) => e.title)
    expect(tomorrow).toEqual(expect.arrayContaining(["CSC215 Office Hours", "BIO110 Review Session", "Dentist"]))
  })

  it("C/D. several deadlines: overdue and due-today work first; the exam and project ahead of the far-off lab", async () => {
    const w = await world()
    const ranked = w.planner.planFor(TODAY).ranked.map((s) => s.task.id)
    expect(ranked.slice(0, 2).sort()).toEqual([id.essay, id.pset].sort())
    expect(ranked.indexOf(id.exam)).toBeLessThan(ranked.indexOf(id.lab))
    expect(ranked.indexOf(id.project)).toBeLessThan(ranked.indexOf(id.lab))
    // Completed work isn't planned.
    expect(ranked).not.toContain(id.peer)
  })

  it("D. the overdue essay is in Needs Attention and gets a reminder", async () => {
    const w = await world()
    expect(w.planner.planFor(TODAY).warnings.some((warning) => warning.kind === "overdue" && warning.taskIds.includes(id.essay))).toBe(true)
    const reminders = generateNotifications({
      now: instantAt(TODAY, "14:30", NY),
      timeZone: NY,
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
      studyStart: "08:00",
      tasks: w.data.tasks,
      studySessions: w.data.studySessions,
      events: w.data.events,
      commitments: w.data.recurringCommitments,
      externalEvents: w.data.externalEvents,
      plan: null,
    })
    expect(reminders.some((r) => r.type === "task_overdue" && r.relatedTaskId === id.essay)).toBe(true)
  })

  it("E. the 6-hour project is split into blocks over several days (never one long block)", async () => {
    const w = await world()
    const days = new Set<string>()
    for (let i = 0; i < 5; i++) {
      const date = addDays(TODAY, i)
      for (const s of w.planner.planFor(date).suggestions.filter((s) => s.taskId === id.project)) {
        days.add(date)
        expect(toMinutes(s.endTime) - toMinutes(s.startTime)).toBeLessThanOrEqual(120)
      }
    }
    expect(days.size).toBeGreaterThan(1)
  })

  it("F. a fully booked day: no invented time; What now points to the next real opportunity", async () => {
    const full = await createEvent(t.db, maya, { title: "Tournament", date: TODAY, startTime: "14:00", endTime: "23:00", type: "sports" })
    const w = await world()
    const plan = w.planner.planFor(TODAY)
    expect(plan.suggestions).toEqual([])
    const answer = now(w)
    expect(answer.kind).toBe("busy")
    if (answer.kind === "busy") {
      expect(answer.until).toBe("23:00")
      expect((answer.next?.date ?? "") > TODAY).toBe(true)
    }
    await t.db.delete((await import("../db/schema")).events).where(eq((await import("../db/schema")).events.id, full.id))
  })

  it("G. a missed session isn't counted as done, its work is planned again, and it's flagged", async () => {
    const missed = await createStudySession(t.db, maya, { taskId: id.reading, date: TODAY, startTime: "13:00", endTime: "13:45", status: "scheduled" })
    const w = await world()
    const reading = w.planner.planFor(TODAY).ranked.find((s) => s.task.id === id.reading)
    expect(reading?.remainingMinutes).toBe(45)
    expect(w.planner.planFor(TODAY).warnings.some((warning) => warning.kind === "missed")).toBe(true)
    await t.db.delete(sessionsTable).where(eq(sessionsTable.id, missed.id))
  })

  it("H. partial progress: 30 of 60 minutes done leaves 30 to plan", async () => {
    const partly = await createStudySession(t.db, maya, { taskId: id.pset, date: TODAY, startTime: "12:30", endTime: "13:30", status: "completed", completedMinutes: 30 })
    const w = await world()
    expect(w.planner.planFor(TODAY).ranked.find((s) => s.task.id === id.pset)?.remainingMinutes).toBe(30)
    await t.db.delete(sessionsTable).where(eq(sessionsTable.id, partly.id))
  })
})

describe("What should I do now?", () => {
  beforeEach(async () => {
    await updateTask(t.db, maya, id.essay, { status: "not_started" })
    await updateTask(t.db, maya, id.pset, { status: "not_started" })
  })

  it("1. free now: the Planner's own first recommendation, with reasons", async () => {
    const w = await world()
    const answer = now(w)
    expect(answer.kind).toBe("work")
    if (answer.kind !== "work") return
    expect(answer.session).toEqual(w.planner.planFor(TODAY).suggestions[0])
    expect([id.essay, id.pset]).toContain(answer.task.id)
    expect(answer.reasons.length).toBeGreaterThan(0)
    // 2:30 -> soccer at 4:00: 90 minutes free.
    expect(answer.availableMinutes).toBe(90)
  })

  it("2. at soccer: busy until 6:00 PM, then the next real opportunity", async () => {
    const w = await world(at(TODAY, "16:30"))
    const answer = now(w, at(TODAY, "16:30"))
    expect(answer).toMatchObject({ kind: "busy", until: "18:00", event: { title: "Soccer Practice" } })
    if (answer.kind === "busy") expect(answer.next && toMinutes(answer.next.startTime)).toBeGreaterThanOrEqual(toMinutes("18:00"))
  })

  it("3. a short window: the recommendation fits it (nothing longer than the gap)", async () => {
    // 3:30 PM: 30 minutes before soccer.
    const w = await world(at(TODAY, "15:30"))
    const answer = now(w, at(TODAY, "15:30"))
    if (answer.kind === "work") {
      expect(toMinutes(answer.session.endTime)).toBeLessThanOrEqual(toMinutes("16:00"))
      expect(answer.availableMinutes).toBeLessThanOrEqual(30)
    } else {
      expect(["no-time", "done"]).toContain(answer.kind)
    }
  })

  it("7. after completing the recommendation, the next one is different", async () => {
    const first = now(await world())
    expect(first.kind).toBe("work")
    if (first.kind !== "work") return
    await updateTask(t.db, maya, first.task.id, { status: "completed" })
    const second = now(await world())
    expect(second.kind === "work" ? second.task.id : null).not.toBe(first.task.id)
  })

  it("6. nothing useful possible (study limit reached): says when the next opportunity is, invents nothing", async () => {
    const booked = await createStudySession(t.db, maya, { taskId: id.lab, date: TODAY, startTime: "08:00", endTime: "11:00", status: "completed" })
    const booked2 = await createStudySession(t.db, maya, { taskId: id.lab, date: TODAY, startTime: "12:30", endTime: "13:30", status: "completed" })
    const w = await world()
    const answer = now(w)
    expect(answer.kind).toBe("no-time")
    if (answer.kind === "no-time") expect((answer.next?.date ?? "") > TODAY).toBe(true)
    await t.db.delete(sessionsTable).where(eq(sessionsTable.id, booked.id))
    await t.db.delete(sessionsTable).where(eq(sessionsTable.id, booked2.id))
  })
})

describe("data consistency", () => {
  it("moving an event changes busy time and What now straight away", async () => {
    await updateEvent(t.db, maya, id.dinner, { startTime: "14:15", endTime: "15:30" })
    const w = await world()
    expect(now(w)).toMatchObject({ kind: "busy", until: "15:30", event: { title: "Dinner with family" } })
    await updateEvent(t.db, maya, id.dinner, { startTime: "18:30", endTime: "19:30" })
  })

  it("deleting a task removes it from the plan and its study sessions; its reminders go away", async () => {
    const extra = await createTask(t.db, maya, { courseId: id.PSY101, title: "Quiz prep", description: "", type: "study", dueDate: "2026-09-20", priority: "high", estimateMinutes: 30, status: "not_started" })
    await createStudySession(t.db, maya, { taskId: extra.id, date: "2026-09-26", startTime: "14:00", endTime: "14:30", status: "scheduled" })
    await syncNotifications(t.db, maya, { now: instantAt(TODAY, "14:30", NY), timeZone: NY })
    expect((await listNotifications(t.db, maya)).some((n) => n.relatedTaskId === extra.id)).toBe(true)
    await deleteTask(t.db, maya, extra.id)
    const w = await world()
    expect(w.data.studySessions.some((s) => s.taskId === extra.id)).toBe(false)
    expect(w.planner.planFor(TODAY).ranked.some((s) => s.task.id === extra.id)).toBe(false)
    await syncNotifications(t.db, maya, { now: instantAt(TODAY, "14:31", NY), timeZone: NY })
    expect((await listNotifications(t.db, maya)).some((n) => n.relatedTaskId === extra.id)).toBe(false)
  })

  it("deleting a course deletes its tasks and their sessions; events linked to it stay", async () => {
    const course = await createCourse(t.db, maya, { code: "ART100", name: "Drawing", professor: "", description: "" })
    const task = await createTask(t.db, maya, { courseId: course.id, title: "Sketchbook", description: "", type: "assignment", dueDate: "2026-10-01", priority: "low", estimateMinutes: 60, status: "not_started" })
    await createStudySession(t.db, maya, { taskId: task.id, date: "2026-09-27", startTime: "10:00", endTime: "11:00", status: "scheduled" })
    const event = await createEvent(t.db, maya, { title: "Art class", date: "2026-09-28", startTime: "13:00", endTime: "14:00", type: "class", courseId: course.id })
    await deleteCourse(t.db, maya, course.id)
    const data = await loadAppData(t.db, maya)
    expect(data.tasks.some((x) => x.id === task.id)).toBe(false)
    expect(data.studySessions.some((s) => s.taskId === task.id)).toBe(false)
    expect(data.events.find((e) => e.id === event.id)?.courseId).toBeUndefined()
    expect((await t.db.select().from(tasksTable).where(eq(tasksTable.courseId, course.id))).length).toBe(0)
  })

  it("external events: time zone correct on the Calendar, and a date boundary (event past midnight shows on both days)", async () => {
    await t.db.insert(externalCalendarEvents).values({ userId: maya, source: "google", externalId: "late@google.com", title: "Late study group", startsAt: instantAt("2026-09-26", "23:00", NY), endsAt: instantAt("2026-09-27", "00:30", NY) })
    const data = await loadAppData(t.db, maya)
    const items = externalEventsAsCalendarItems(data.externalEvents, NY).filter((i) => i.title === "Late study group")
    expect(items.map((i) => [i.date, i.startTime, i.endTime])).toEqual([["2026-09-26", "23:00", "24:00"], ["2026-09-27", "00:00", "00:30"]])
    const dentist = externalEventsAsCalendarItems(data.externalEvents, NY).find((i) => i.title === "Dentist")
    expect(dentist).toMatchObject({ date: "2026-09-25", startTime: "15:00", endTime: "16:00" })
  })
})
