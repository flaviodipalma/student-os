import { randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { generatePlan } from "@/lib/planner"
import type { LmsAssignment, LmsCourse } from "@/lib/lms/types"
import type { LmsProviderId } from "@/lib/types"
import { lmsConnections } from "../../db/schema"
import { NotFoundError } from "../../errors"
import { createTestDb } from "../../test-utils/test-db"
import { loadAppData } from "../../services/app-data"
import { createCourse } from "../../services/courses"
import { createTask, updateTask } from "../../services/tasks"
import {
  disconnectLms,
  getLmsIntegrationStatus,
  listLmsConnections,
  loadLmsCredentials,
  saveLmsConnection,
} from "./connections"
import { createCredentialVault, credentialContext, CredentialVaultError } from "./credential-vault"
import { LmsNotAvailableError, type LmsAccess, type LmsProvider, type LmsTokenSet } from "./provider"
import { getLmsProvider, listLmsProviders } from "./registry"
import { syncLms } from "./sync"

// The LMS architecture against a real Postgres (PGlite). No Canvas or
// Blackboard API is called anywhere in here.

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const vault = createCredentialVault(randomBytes(32))
const NOW = new Date(2026, 8, 21, 8, 0)
const tokens = (accessToken = "test-access-token"): LmsTokenSet & { baseUrl: string | null } => ({
  accessToken,
  refreshToken: "test-refresh-token",
  expiresAt: new Date(2026, 8, 22),
  externalUserId: "lms-user-1",
  baseUrl: "https://lms.test.invalid",
})

// ---------------------------------------------------------------------------------
// TEST FIXTURE PROVIDER. Returns hand-written data that is already in Student
// OS's NORMALIZED format. It is not Canvas or Blackboard, doesn't imitate their
// APIs, and exists only to drive the provider-independent sync pipeline.
class FixtureLmsProvider implements LmsProvider {
  readonly id: LmsProviderId = "canvas"
  readonly name = "Test fixture LMS"
  readonly available = true
  seenTokens: string[] = []
  constructor(
    public courses: LmsCourse[],
    public assignments: LmsAssignment[]
  ) {}
  isConfigured() {
    return true
  }
  getAuthorizationUrl(): string {
    throw new Error("not used in tests")
  }
  async exchangeCode(): Promise<LmsTokenSet> {
    throw new Error("not used in tests")
  }
  async refreshTokens(): Promise<LmsTokenSet> {
    throw new Error("not used in tests")
  }
  async revokeTokens() {}
  async getCourses(access: LmsAccess) {
    this.seenTokens.push(await access.getAccessToken())
    return this.courses
  }
  async getCourseDetails(_: LmsAccess, id: string) {
    return this.courses.find((c) => c.externalId === id)!
  }
  async getAssignments(_: LmsAccess, courseExternalId: string) {
    return this.assignments.filter((a) => a.courseExternalId === courseExternalId)
  }
}

const fixtureCourse = (overrides: Partial<LmsCourse> = {}): LmsCourse => ({
  provider: "canvas",
  externalId: "fixture-course-1",
  courseCode: "CSC 215",
  courseName: "Data Structures",
  description: null,
  instructor: "Prof. Smith",
  url: "https://lms.test.invalid/courses/1",
  ...overrides,
})
const fixtureAssignment = (overrides: Partial<LmsAssignment> = {}): LmsAssignment => ({
  provider: "canvas",
  externalId: "fixture-assignment-1",
  courseExternalId: "fixture-course-1",
  title: "Project 1",
  description: "Linked lists",
  dueDate: "2026-09-23",
  dueTime: "23:59",
  type: "project",
  url: "https://lms.test.invalid/assignments/1",
  estimatedMinutes: 120,
  submissionStatus: "not_submitted",
  ...overrides,
})
// ---------------------------------------------------------------------------------

async function connectedStudent(name = "Alex") {
  const user = await t.addUser(name)
  await saveLmsConnection(t.db, user, "canvas", tokens(), vault)
  return user
}

describe("credential vault (token encryption)", () => {
  it("encrypts and decrypts, never storing the plain token", () => {
    const sealed = vault.seal("secret-token", "user:canvas")
    expect(sealed).not.toContain("secret-token")
    expect(sealed.startsWith("v1:")).toBe(true)
    expect(vault.open(sealed, "user:canvas")).toBe("secret-token")
    expect(vault.seal("secret-token", "user:canvas")).not.toBe(sealed) // random IV each time
  })

  it("refuses tampered data, the wrong owner, or the wrong key, without revealing anything", () => {
    const sealed = vault.seal("secret-token", "alice:canvas")
    const parts = sealed.split(":")
    const tampered = [...parts.slice(0, 3), Buffer.from("x" + Buffer.from(parts[3], "base64").toString()).toString("base64")].join(":")
    expect(() => vault.open(tampered, "alice:canvas")).toThrow(CredentialVaultError)
    expect(() => vault.open(sealed, "bob:canvas")).toThrow(CredentialVaultError)
    expect(() => createCredentialVault(randomBytes(32)).open(sealed, "alice:canvas")).toThrow("couldn't be decrypted")
    expect(() => createCredentialVault(randomBytes(16))).toThrow("32 bytes")
  })
})

describe("providers", () => {
  it("has a Canvas and a Blackboard adapter behind one interface", () => {
    expect(listLmsProviders().map((p) => [p.id, p.name])).toEqual([
      ["canvas", "Canvas"],
      ["blackboard", "Blackboard"],
    ])
    expect(getLmsProvider("canvas").id).toBe("canvas")
    expect(getLmsProvider("blackboard").id).toBe("blackboard")
  })

  it("Blackboard isn't implemented yet: every call fails clearly and nothing touches the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch")
    const provider = getLmsProvider("blackboard")
    const access: LmsAccess = {
      baseUrl: "https://lms.test.invalid",
      timeZone: undefined,
      getAccessToken: async () => "x",
      refreshAccessToken: async () => "x",
    }
    expect(provider.available).toBe(false)
    expect(() => provider.getAuthorizationUrl({ baseUrl: "", state: "" })).toThrow(LmsNotAvailableError)
    await expect(provider.getCourses(access)).rejects.toThrow("Blackboard integration isn't available yet.")
    await expect(provider.getAssignments(access, "1")).rejects.toBeInstanceOf(LmsNotAvailableError)
    await expect(provider.exchangeCode({ baseUrl: "", code: "" })).rejects.toBeInstanceOf(LmsNotAvailableError)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it("Canvas is implemented, and only usable once the server is configured", () => {
    const canvas = getLmsProvider("canvas")
    expect(canvas.available).toBe(true)
    expect(canvas.isConfigured()).toBe(Boolean(process.env.CANVAS_CLIENT_ID && process.env.CANVAS_CLIENT_SECRET && process.env.CANVAS_REDIRECT_URI))
  })
})

describe("LMS connections", () => {
  it("stores tokens encrypted and only returns a token-free summary", async () => {
    const user = await connectedStudent()
    const [row] = await t.db.select().from(lmsConnections)
    expect(row.accessTokenEncrypted).not.toContain("test-access-token")
    expect(row.refreshTokenEncrypted).not.toContain("test-refresh-token")

    const [summary] = await listLmsConnections(t.db, user)
    expect(summary).toEqual({
      provider: "canvas",
      method: "oauth",
      status: "connected",
      connectedAt: expect.any(String),
      lastSyncedAt: null,
      lastSyncError: null,
    })
    expect(JSON.stringify(await getLmsIntegrationStatus(t.db, user))).not.toMatch(/test-access|test-refresh|lms-user-1/)
    expect((await loadLmsCredentials(t.db, user, "canvas", vault)).accessToken).toBe("test-access-token")
  })

  it("shows Canvas as available (if configured) and Blackboard as coming soon in Settings", async () => {
    const user = await t.addUser()
    expect(await getLmsIntegrationStatus(t.db, user)).toEqual([
      { provider: "canvas", name: "Canvas", available: true, configured: getLmsProvider("canvas").isConfigured(), connection: null },
      { provider: "blackboard", name: "Blackboard", available: false, configured: false, connection: null },
    ])
  })

  it("reconnecting replaces the tokens (one connection per provider)", async () => {
    const user = await connectedStudent()
    await saveLmsConnection(t.db, user, "canvas", tokens("new-access-token"), vault)
    expect(await t.db.select().from(lmsConnections)).toHaveLength(1)
    expect((await loadLmsCredentials(t.db, user, "canvas", vault)).accessToken).toBe("new-access-token")
  })

  it("one student can't see, use or remove another's connection", async () => {
    const alice = await connectedStudent("Alice")
    const bob = await t.addUser("Bob")
    expect(await listLmsConnections(t.db, bob)).toEqual([])
    await expect(loadLmsCredentials(t.db, bob, "canvas", vault)).rejects.toBeInstanceOf(NotFoundError)
    await expect(disconnectLms(t.db, bob, "canvas")).rejects.toBeInstanceOf(NotFoundError)
    await expect(syncLms(t.db, bob, new FixtureLmsProvider([fixtureCourse()], []), vault)).rejects.toBeInstanceOf(NotFoundError)
    expect(await listLmsConnections(t.db, alice)).toHaveLength(1)

    // Alice's encrypted token copied into Bob's row doesn't decrypt for Bob.
    const [alicesRow] = await t.db.select().from(lmsConnections)
    await t.db.insert(lmsConnections).values({ userId: bob, provider: "canvas", accessTokenEncrypted: alicesRow.accessTokenEncrypted })
    await expect(loadLmsCredentials(t.db, bob, "canvas", vault)).rejects.toThrow("couldn't be decrypted")
    expect(credentialContext(alice, "canvas")).not.toBe(credentialContext(bob, "canvas"))
  })

  it("disconnecting deletes the tokens but keeps imported courses and tasks", async () => {
    const user = await connectedStudent()
    await syncLms(t.db, user, new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()]), vault, { now: NOW })
    await disconnectLms(t.db, user, "canvas")
    expect(await t.db.select().from(lmsConnections)).toEqual([])
    const data = await loadAppData(t.db, user)
    expect(data.courses).toHaveLength(1)
    expect(data.tasks).toHaveLength(1)
  })
})

describe("syncing (with the test fixture provider)", () => {
  it("imports LMS courses and assignments as normal courses and tasks, with their source", async () => {
    const user = await connectedStudent()
    const provider = new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment(), fixtureAssignment({ externalId: "no-date", dueDate: null })])
    const result = await syncLms(t.db, user, provider, vault, { now: NOW })

    expect(result).toEqual({
      provider: "canvas",
      coursesCreated: 1,
      coursesUpdated: 0,
      coursesLinked: 0,
      coursesSkipped: 0,
      assignmentsCreated: 1,
      assignmentsUpdated: 0,
      assignmentsLinked: 0,
      assignmentsSkipped: 1,
      assignmentsWithoutDueDate: 1,
      assignmentsCompleted: 0,
      assignmentsMissing: 0,
      missing: [],
      missingCourses: [],
      conflicts: [],
      errors: [],
      syncedAt: NOW.toISOString(),
    })
    expect(provider.seenTokens).toEqual(["test-access-token"]) // decrypted on the server for the adapter
    const data = await loadAppData(t.db, user)
    expect(data.courses[0]).toMatchObject({
      code: "CSC 215",
      name: "Data Structures",
      professor: "Prof. Smith",
      source: { provider: "canvas", externalId: "fixture-course-1", url: "https://lms.test.invalid/courses/1" },
    })
    expect(data.tasks[0]).toMatchObject({
      courseId: data.courses[0].id,
      title: "Project 1",
      description: "Linked lists",
      dueDate: "2026-09-23",
      dueTime: "23:59",
      estimateMinutes: 120,
      priority: "medium",
      status: "not_started",
      source: { provider: "canvas", externalId: "fixture-assignment-1" },
    })
    expect((await listLmsConnections(t.db, user))[0].lastSyncedAt).toBe(NOW.toISOString())
  })

  it("syncing again creates no duplicates", async () => {
    const user = await connectedStudent()
    const provider = new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()])
    await syncLms(t.db, user, provider, vault, { now: NOW })
    const again = await syncLms(t.db, user, provider, vault, { now: NOW })
    expect(again).toMatchObject({ coursesCreated: 0, assignmentsCreated: 0, assignmentsSkipped: 1 })
    const data = await loadAppData(t.db, user)
    expect(data.courses).toHaveLength(1)
    expect(data.tasks).toHaveLength(1)
  })

  it("applies LMS changes, but keeps the student's own changes and reports conflicts", async () => {
    const user = await connectedStudent()
    const provider = new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()])
    await syncLms(t.db, user, provider, vault, { now: NOW })
    const [task] = (await loadAppData(t.db, user)).tasks

    // The LMS moves the due date; the student only changed priority: the date updates, priority stays.
    await updateTask(t.db, user, task.id, { priority: "critical" })
    provider.assignments = [fixtureAssignment({ dueDate: "2026-09-25" })]
    const first = await syncLms(t.db, user, provider, vault, { now: NOW })
    expect(first.assignmentsUpdated).toBe(1)
    expect((await loadAppData(t.db, user)).tasks[0]).toMatchObject({ dueDate: "2026-09-25", priority: "critical" })

    // Now the student moves it to Saturday and the LMS moves it too: the student's date wins.
    await updateTask(t.db, user, task.id, { dueDate: "2026-09-26" })
    provider.assignments = [fixtureAssignment({ dueDate: "2026-09-24" })]
    const second = await syncLms(t.db, user, provider, vault, { now: NOW })
    expect(second.conflicts).toEqual([
      { taskId: task.id, title: "Project 1", field: "dueDate", studentValue: "2026-09-26", lmsValue: "2026-09-24" },
    ])
    expect((await loadAppData(t.db, user)).tasks[0].dueDate).toBe("2026-09-26")
    // Reported once: the next sync with the same LMS value is quiet.
    expect((await syncLms(t.db, user, provider, vault, { now: NOW })).conflicts).toEqual([])
  })

  it("never deletes a task the LMS stopped listing; reports it as missing", async () => {
    const user = await connectedStudent()
    const provider = new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()])
    await syncLms(t.db, user, provider, vault, { now: NOW })
    provider.assignments = []
    const result = await syncLms(t.db, user, provider, vault, { now: NOW })
    expect(result.assignmentsMissing).toBe(1)
    expect(result.missing).toEqual([{ taskId: expect.any(String), title: "Project 1" }])
    expect((await loadAppData(t.db, user)).tasks).toHaveLength(1)
  })

  it("links to a course and task the student already imported from a syllabus", async () => {
    const user = await connectedStudent()
    const course = await createCourse(t.db, user, { code: "CSC215", name: "Data Structures", professor: "", description: "" })
    await createTask(t.db, user, {
      courseId: course.id,
      title: "Project #1",
      description: "From the syllabus",
      type: "project",
      dueDate: "2026-09-23",
      priority: "high",
      estimateMinutes: 240,
      status: "in_progress",
    })
    const result = await syncLms(t.db, user, new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()]), vault, { now: NOW })
    expect(result).toMatchObject({ coursesLinked: 1, coursesCreated: 0, assignmentsLinked: 1, assignmentsCreated: 0 })
    const data = await loadAppData(t.db, user)
    expect(data.courses).toHaveLength(1)
    expect(data.tasks).toEqual([
      expect.objectContaining({
        title: "Project #1", // the student's values are kept when linking
        priority: "high",
        status: "in_progress",
        source: expect.objectContaining({ externalId: "fixture-assignment-1" }),
      }),
    ])
  })

  it("keeps each student's imports separate, even for the same LMS ids", async () => {
    const alice = await connectedStudent("Alice")
    const bob = await connectedStudent("Bob")
    const provider = new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()])
    await syncLms(t.db, alice, provider, vault, { now: NOW })
    await syncLms(t.db, bob, provider, vault, { now: NOW })
    const alices = await loadAppData(t.db, alice)
    const bobs = await loadAppData(t.db, bob)
    expect(alices.tasks).toHaveLength(1)
    expect(bobs.tasks).toHaveLength(1)
    expect(alices.tasks[0].id).not.toBe(bobs.tasks[0].id)
    expect(bobs.courses[0].id).not.toBe(alices.courses[0].id)
  })

  it("an unavailable provider fails safely: nothing imported, a safe message recorded", async () => {
    const user = await t.addUser()
    await saveLmsConnection(t.db, user, "blackboard", tokens(), vault)
    await expect(syncLms(t.db, user, getLmsProvider("blackboard"), vault, { now: NOW })).rejects.toThrow(
      "Blackboard integration isn't available yet."
    )
    expect((await loadAppData(t.db, user)).courses).toEqual([])
    expect((await listLmsConnections(t.db, user))[0]).toMatchObject({
      status: "error",
      lastSyncError: "Blackboard integration isn't available yet.",
    })
  })

  it("provider errors never reach the student or the database as-is", async () => {
    const user = await connectedStudent()
    const leaky = new FixtureLmsProvider([], [])
    leaky.getCourses = async () => {
      throw new Error("401 for https://lms.test.invalid?access_token=test-access-token")
    }
    const error = await syncLms(t.db, user, leaky, vault, { now: NOW }).catch((e) => e)
    expect(error.message).toBe("Syncing with Test fixture LMS failed. Please try again.")
    expect((await listLmsConnections(t.db, user))[0].lastSyncError).not.toContain("access_token")
  })
})

describe("imported tasks in the rest of Student OS", () => {
  it("the Planner plans them like any other task", async () => {
    const user = await connectedStudent()
    await syncLms(t.db, user, new FixtureLmsProvider([fixtureCourse()], [fixtureAssignment()]), vault, { now: NOW })
    const data = await loadAppData(t.db, user)
    const plan = generatePlan({ date: "2026-09-21", tasks: data.tasks, events: data.events, now: NOW })
    expect(plan.suggestions.some((s) => s.taskId === data.tasks[0].id)).toBe(true)
  })

  it("the student's own and syllabus data are unaffected (no source)", async () => {
    const user = await t.addUser()
    const course = await createCourse(t.db, user, { code: "BIO110", name: "Biology", professor: "", description: "" })
    await createTask(t.db, user, {
      courseId: course.id,
      title: "Lab",
      description: "",
      type: "lab",
      dueDate: "2026-09-25",
      priority: "low",
      estimateMinutes: 60,
      status: "not_started",
    })
    const data = await loadAppData(t.db, user)
    expect(data.courses[0].source).toBeUndefined()
    expect(data.tasks[0].source).toBeUndefined()
  })
})
