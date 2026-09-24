import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { DEFAULT_LEARNING_SETTINGS, type Task } from "@/lib/types"
import { studentPreferences, studySessions as sessionsTable, tasks as tasksTable } from "../db/schema"
import { NotFoundError, ValidationError } from "../errors"
import { createTestDb } from "../test-utils/test-db"
import { MockAssistantService } from "../assistant/mock-assistant-service"
import { createToolContext, type ToolContext } from "../assistant/context"
import { askAssistant, askAssistantSchema, confirmAssistantChange, proposedActionSchema, runTool, type TurnState } from "../assistant/service"
import { loadAppData } from "./app-data"
import { createCourse } from "./courses"
import { getLearningSettings, resetLearning, saveLearningSettings, savePreferences } from "./preferences"
import { createStudySession } from "./study-sessions"
import { createTask } from "./tasks"

// Long-term personalization on a real Postgres (PGlite): corrections through the
// Assistant (proposed, then confirmed), the saved planning mode, explicit
// preferences over learned ones, what-ifs that save nothing, explanations from
// stored data only, reset, and isolation. No real AI.
//
// Clock: Thursday 2026-09-24, 2:00 PM. Sam: 6 finished CSC215 lab reports
// (estimated 60, logged 90) and 8 missed late-night sessions; an open lab
// report and an exam. Bob: another student.

const TZ = "America/New_York"
const TODAY = "2026-09-24"
const NOW = new Date(2026, 8, 24, 14, 0)

let t: Awaited<ReturnType<typeof createTestDb>>
let sam: string
let bob: string
let lab: Task
let exam: Task
let bobTask: Task
let csc: string

beforeAll(async () => {
  t = await createTestDb()
  sam = await t.addUser("Sam")
  bob = await t.addUser("Bob")
  await savePreferences(t.db, sam, { studyStart: "08:00", studyEnd: "23:00", maxStudyMinutesPerDay: 240, preferredBlockMinutes: 60, breakMinutes: 10 })
  csc = (await createCourse(t.db, sam, { code: "CSC215", name: "Databases", professor: "", description: "" })).id
  const psy = (await createCourse(t.db, sam, { code: "PSY101", name: "Psychology", professor: "", description: "" })).id
  for (let i = 0; i < 6; i++) {
    const done = await createTask(t.db, sam, { courseId: csc, title: `Lab ${i + 1}`, description: "", type: "lab", dueDate: `2026-09-1${i}`, priority: "medium", estimateMinutes: 60, status: "completed" })
    await createStudySession(t.db, sam, { taskId: done.id, date: `2026-09-1${i}`, startTime: "15:00", endTime: "16:30", status: "completed" })
    await createStudySession(t.db, sam, { taskId: done.id, date: `2026-09-1${i + 1}`, startTime: "21:30", endTime: "22:30", status: "scheduled" })
    await createStudySession(t.db, sam, { taskId: done.id, date: `2026-09-0${i + 1}`, startTime: "21:30", endTime: "22:30", status: "scheduled" })
  }
  lab = await createTask(t.db, sam, { courseId: csc, title: "Lab 7", description: "", type: "lab", dueDate: "2026-09-27", priority: "medium", estimateMinutes: 60, status: "not_started" })
  exam = await createTask(t.db, sam, { courseId: psy, title: "Psychology Exam", description: "", type: "exam", dueDate: "2026-09-30", priority: "medium", estimateMinutes: 120, status: "not_started" })
  const bobCourse = await createCourse(t.db, bob, { code: "BIO100", name: "Biology", professor: "", description: "" })
  bobTask = await createTask(t.db, bob, { courseId: bobCourse.id, title: "Bob's Essay", description: "", type: "paper", dueDate: "2026-09-26", priority: "high", estimateMinutes: 60, status: "not_started" })
})
afterAll(() => t.close())

const contextFor = async (userId = sam) => createToolContext(await loadAppData(t.db, userId), NOW, TZ)
const call = (ctx: ToolContext, name: string, input: unknown = {}, state: TurnState = {}) => {
  const result = runTool(ctx, state, name, input)
  return { json: JSON.parse(result.content), state }
}
const ask = (content: string, userId = sam) =>
  askAssistant({ db: t.db, userId, now: NOW, timeZone: TZ, ai: new MockAssistantService() }, askAssistantSchema.parse({ messages: [{ role: "user", content }] }))
const snapshot = async () => ({
  prefs: await t.db.select().from(studentPreferences).orderBy(studentPreferences.userId),
  tasks: await t.db.select().from(tasksTable).orderBy(tasksTable.id),
  sessions: await t.db.select().from(sessionsTable).orderBy(sessionsTable.id),
})
const restore = () => saveLearningSettings(t.db, sam, { ...DEFAULT_LEARNING_SETTINGS })

describe("the profile the Assistant sees: explicit, observed, inferred", () => {
  it("each observed value has confidence, observations, newest evidence and a source; nothing invented", async () => {
    const { json } = call(await contextFor(), "getLearnedPatterns")
    expect(json.explicit).toEqual({ planningMode: "balanced", preferredStudyTimes: [], tasksUsingOwnEstimate: 0 })
    expect(json.observed.estimateAccuracy).toMatchObject({ value: 1.5, confidence: "medium", observations: 6, newestEvidence: "2026-09-15", source: "Finished tasks with logged study time" })
    expect(json.observed.oftenMissedTimes).toMatchObject({ value: ["late night"] })
    expect(json.inferred.map((i: { text: string }) => i.text)).toContain("Not in the late night: you often miss or move sessions then, so the Planner uses other free time first.")
    expect(json.insights.map((i: { id: string }) => i.id)).toEqual(expect.arrayContaining([`estimate:ct:${csc}:lab`, "avoid:night"]))
    // Only this student's own history.
    expect(JSON.stringify(json)).not.toContain("Bob")
  })

  it("'Why did you give me this task?' is answered from the Planner's reasons and the stored numbers", async () => {
    const reply = await ask("Why did you give me this task?")
    expect(reply.message).toMatch(/^Lab 7: /)
    expect(reply.message).toContain("Adjusted to 1h 20m from your past CSC215 lab reports")
    expect(reply.message).toContain("Your last 6 CSC215 lab reports took about 1.5× your estimates, so the Planner plans 1h 20m instead of your 1h.")
  })
})

describe("corrections: proposed, confirmed, then used", () => {
  it("'I actually prefer studying at night': a proposal first; after Confirm, explicit beats learned", async () => {
    const before = await snapshot()
    const reply = await ask("I actually prefer studying at night")
    expect(reply.pending?.action).toEqual({ kind: "update-personalization", changes: { preferredPeriods: ["night"] } })
    expect(reply.message).toBe("Personalization: plan your study late at night first (your preference). Confirm below.")
    expect(await snapshot()).toEqual(before)

    const saved = await confirmAssistantChange({ db: t.db, userId: sam, now: NOW, timeZone: TZ }, proposedActionSchema.parse(reply.pending!.action))
    expect(saved.learning?.preferredPeriods).toEqual(["night"])
    const ctx = await contextFor()
    expect(ctx.adaptive!.avoid).toEqual([])
    expect(ctx.planner.planFor("2026-09-25").suggestions[0].startTime).toBe("21:00")
    await restore()
  })

  it("'This estimate is wrong' and 'don't use this pattern'", async () => {
    let ctx = await contextFor()
    const own = call(ctx, "correctPersonalization", { useOwnEstimateFor: "Lab 7" })
    expect(own.json.summary).toBe("Personalization: always use your own estimate for “Lab 7” (1h).")
    await confirmAssistantChange({ db: t.db, userId: sam, now: NOW, timeZone: TZ }, own.state.pending!.action)
    ctx = await contextFor()
    expect(ctx.planner.estimateOf(lab).minutes).toBe(60)
    await restore()

    ctx = await contextFor()
    const off = call(ctx, "correctPersonalization", { dismissPattern: `estimate:ct:${csc}:lab` })
    expect(off.json.status).toBe("needs_confirmation")
    await confirmAssistantChange({ db: t.db, userId: sam, now: NOW, timeZone: TZ }, off.state.pending!.action)
    ctx = await contextFor()
    expect(ctx.adaptive!.estimates[lab.id]).toBeUndefined()
    expect(ctx.adaptive!.insights.find((i) => i.id === `estimate:ct:${csc}:lab`)?.dismissed).toBe(true)
    await restore()
  })

  it("corrections are checked: unknown patterns, other students' tasks, malformed input", async () => {
    const ctx = await contextFor()
    expect(call(ctx, "correctPersonalization", { dismissPattern: "avoid:morning" }).json).toMatchObject({ status: "not_possible" })
    expect(call(ctx, "correctPersonalization", { dismissPattern: "x'); drop table tasks;--" }).json).toMatchObject({ status: "not_possible" })
    expect(call(ctx, "correctPersonalization", { useOwnEstimateFor: bobTask.id }).json).toMatchObject({ status: "not_found" })
    expect(call(ctx, "correctPersonalization", { planningMode: "autopilot" }).json.error).toBe("invalid_arguments")
    expect(call(ctx, "correctPersonalization", { userId: bob }).json.error).toBe("invalid_arguments")
    await expect(
      confirmAssistantChange({ db: t.db, userId: sam, now: NOW, timeZone: TZ }, { kind: "update-personalization", changes: { useOwnEstimateFor: bobTask.id } })
    ).rejects.toBeInstanceOf(ValidationError)
    await expect(saveLearningSettings(t.db, sam, { ownEstimateTaskIds: [bobTask.id] })).rejects.toBeInstanceOf(NotFoundError)
    // The database refuses nonsense too.
    await expect(t.db.update(studentPreferences).set({ planningMode: "autopilot" }).where(eq(studentPreferences.userId, sam))).rejects.toThrow()
  })

  it("the Assistant can't change settings without a proposal (one change per reply)", async () => {
    const state: TurnState = {}
    const ctx = await contextFor()
    call(ctx, "correctPersonalization", { useStudyTimes: false }, state)
    expect(call(ctx, "correctPersonalization", { useWorkload: false }, state).json.status).toBe("rejected")
    expect((await getLearningSettings(t.db, sam)).useStudyTimes).toBe(true)
  })
})

describe("planning mode and what-ifs", () => {
  it("the saved mode shapes the plan (and says so); a what-if can try another without saving it", async () => {
    await saveLearningSettings(t.db, sam, { planningMode: "exam-focus" })
    const ctx = await contextFor()
    const today = ctx.planner.planFor(TODAY)
    expect(today.suggestions.find((s) => s.taskId === exam.id)?.reasons).toContain("Exam focus (your planning mode)")
    const before = await snapshot()
    const { json } = call(ctx, "simulatePlanChange", { intent: { mode: "deadline-focus" } })
    expect(json.scenario.assumptions).toContain("Mode: deadline-focus")
    expect(await snapshot()).toEqual(before)
    await restore()
  })

  it("'What if I only want to study two hours today?': what moves, where it goes; nothing saved", async () => {
    const before = await snapshot()
    const reply = await ask("What if I only want to study two hours today?")
    expect(reply.message).toMatch(/^(With at most 2h today, \S+ moves off today|Today's plan \(\S+\) is already within 2h, so nothing would change)/)
    expect(reply.message).toMatch(/nothing was saved\.$/)
    expect(reply.pending).toBeUndefined()
    expect(await snapshot()).toEqual(before)
    const { json } = call(await contextFor(), "simulatePlanChange", { intent: { maxStudyMinutes: [{ date: TODAY, minutes: 30 }] } })
    expect(json.comparedWithCurrentPlan.tasksThatMove.length).toBeGreaterThan(0)
    expect(json.comparedWithCurrentPlan.workMovedOffToday).toBe("30m")
    expect(json.scenario.days[0].study).toBe("30m")
  })
})

describe("reset and isolation", () => {
  it("reset clears learning and corrections, keeps the student's explicit choices", async () => {
    await saveLearningSettings(t.db, sam, { planningMode: "light-day", preferredPeriods: ["afternoon"], dismissedPatterns: ["avoid:night"], ownEstimateTaskIds: [lab.id] })
    const after = await resetLearning(t.db, sam, TODAY)
    expect(after).toMatchObject({ since: TODAY, planningMode: "light-day", preferredPeriods: ["afternoon"], dismissedPatterns: [], ownEstimateTaskIds: [] })
    const ctx = await contextFor()
    expect(ctx.adaptive).toMatchObject({ observations: 0, estimates: {}, avoid: [] })
    await t.db.update(studentPreferences).set({ adaptiveSince: null }).where(eq(studentPreferences.userId, sam))
    await restore()
  })

  it("another student's settings and profile are untouched and separate", async () => {
    await saveLearningSettings(t.db, sam, { planningMode: "deadline-focus" })
    expect((await getLearningSettings(t.db, bob)).planningMode).toBe("balanced")
    const bobCtx = await contextFor(bob)
    expect(bobCtx.adaptive).toMatchObject({ observations: 0, insights: [] })
    expect(call(bobCtx, "getLearnedPatterns").json.explicit.planningMode).toBe("balanced")
    await restore()
  })
})
