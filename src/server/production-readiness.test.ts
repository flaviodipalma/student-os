import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { readdirSync } from "node:fs"
import { generateNotifications } from "@/lib/notifications/generate"
import { createPlanner, whatNow } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import { scheduleBetween } from "@/lib/recurring"
import { instantAt } from "@/lib/time-zone"
import type { CalendarEvent, Course, RecurringCommitment, StudySessionRecord, Task } from "@/lib/types"
import type { Database } from "./db/types"
import { createTestDb } from "./test-utils/test-db"

// Production readiness (Prompt 28): startup checks, health endpoints, logs,
// migrations, the Planner under a heavy realistic load, daylight saving time,
// and all-or-nothing imports. No external service is contacted.

const db = vi.hoisted(() => ({ current: null as unknown, fail: false }))
vi.mock("@/server/db", () => ({
  getDb: () => {
    if (db.fail) return { execute: () => new Promise((_, reject) => setTimeout(() => reject(new Error("ECONNREFUSED 10.0.0.5")), 5)) }
    return db.current
  },
}))

const { checkEnv } = await import("./env")
const { logger } = await import("./log")
const { GET: live } = await import("@/app/api/health/route")
const { GET: ready } = await import("@/app/api/health/ready/route")
const { saveSyllabusImport } = await import("./services/syllabus")
const schema = await import("./db/schema")

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
  db.current = t.db as Database
})
afterAll(() => t.close())

const base = {
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  DATABASE_URL: "postgresql://user:pw@db.example.com:6543/postgres",
  ANTHROPIC_API_KEY: "set",
  LMS_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
}

describe("environment checks (server start and `npm run check:env`)", () => {
  it("a complete development setup passes; missing core settings are errors", () => {
    expect(checkEnv(base, false).errors).toEqual([])
    const { errors } = checkEnv({ ...base, DATABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined }, false)
    expect(errors.join("\n")).toMatch(/DATABASE_URL/)
    expect(errors.join("\n")).toMatch(/NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/)
  })

  it("never prints values, only names", () => {
    const report = checkEnv({ ...base, LMS_TOKEN_ENCRYPTION_KEY: "short-secret-value", GOOGLE_CALENDAR_CLIENT_ID: "id-123" }, false)
    const text = [...report.errors, ...report.warnings].join("\n")
    expect(text).toMatch(/LMS_TOKEN_ENCRYPTION_KEY must be 32 random bytes/)
    expect(text).toMatch(/Google Calendar: set all of/)
    expect(text).not.toMatch(/short-secret-value|id-123|pw@/)
  })

  it("a secret with a public NEXT_PUBLIC_ name is refused", () => {
    expect(checkEnv({ ...base, NEXT_PUBLIC_ANTHROPIC_API_KEY: "x" }, false).errors.join()).toMatch(/NEXT_PUBLIC_ANTHROPIC_API_KEY looks like a secret/)
  })

  it("deployment rules: HTTPS SITE_URL, no localhost redirects, no mock AI, an AI key", () => {
    const deploy = {
      ...base,
      APP_ENV: "production",
      SITE_URL: "https://studentos.app",
      GOOGLE_CALENDAR_CLIENT_ID: "a",
      GOOGLE_CALENDAR_CLIENT_SECRET: "b",
      GOOGLE_CALENDAR_REDIRECT_URI: "https://studentos.app/api/integrations/google-calendar/callback",
    }
    expect(checkEnv(deploy).errors).toEqual([])
    const bad = checkEnv({ ...deploy, SITE_URL: "http://studentos.app", GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/cb", SYLLABUS_AI_PROVIDER: "mock", ANTHROPIC_API_KEY: undefined })
    const text = bad.errors.join("\n")
    expect(text).toMatch(/SITE_URL must use https/)
    expect(text).toMatch(/GOOGLE_CALENDAR_REDIRECT_URI must be an https:\/\/ URL/)
    expect(text).toMatch(/MOCK provider/)
    // Real AI without a key: an error in production.
    expect(checkEnv({ ...deploy, ANTHROPIC_API_KEY: undefined }).errors.join()).toMatch(/ANTHROPIC_API_KEY isn't set/)
    // The same values on a laptop (no APP_ENV) are only warnings or fine.
    expect(checkEnv({ ...deploy, APP_ENV: undefined, GOOGLE_CALENDAR_REDIRECT_URI: "http://localhost:3000/cb", SYLLABUS_AI_PROVIDER: "mock" }).errors).toEqual([])
  })

  it("browser extension ids: checked when set; a production warning when not", () => {
    const deploy = { ...base, APP_ENV: "production", SITE_URL: "https://studentos.app" }
    expect(checkEnv(deploy).warnings.join()).toMatch(/STUDENT_OS_EXTENSION_IDS isn't set/)
    expect(checkEnv({ ...base, SITE_URL: "https://studentos.app" }, false).warnings.join()).not.toMatch(/STUDENT_OS_EXTENSION_IDS/)
    const ok = checkEnv({ ...deploy, STUDENT_OS_EXTENSION_IDS: "abcdefghijklmnopabcdefghijklmnop" })
    expect([...ok.errors, ...ok.warnings].join()).not.toMatch(/STUDENT_OS_EXTENSION_IDS/)
    expect(checkEnv({ ...deploy, STUDENT_OS_EXTENSION_IDS: "chrome-extension://abc" }).errors.join()).toMatch(/must be Chrome extension ids/)
  })
})

describe("health checks", () => {
  it("liveness: always ok, nothing else", async () => {
    const response = live()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ok" })
    expect(response.headers.get("cache-control")).toBe("no-store")
  })

  it("readiness: ok with the database; 503 and no details when it's down", async () => {
    const up = await ready()
    expect(up.status).toBe(200)
    expect(await up.json()).toEqual({ status: "ok", checks: { database: "ok" } })
    db.fail = true
    vi.spyOn(console, "error").mockImplementation(() => {})
    const down = await ready()
    db.fail = false
    expect(down.status).toBe(503)
    const body = await down.text()
    expect(JSON.parse(body)).toEqual({ status: "unavailable", checks: { database: "unavailable" } })
    expect(body).not.toMatch(/ECONNREFUSED|10\.0\.0\.5/)
  })
})

describe("logs", () => {
  it("structured, and never carry secrets or data (names that look secret are redacted; objects aren't logged)", () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, "error").mockImplementation((line: unknown) => void lines.push(String(line)))
    vi.stubEnv("NODE_ENV", "production")
    logger.error("calendar:google", "sync failed", {
      kind: "rate-limited",
      accessToken: "ya29.secret",
      refresh_token: "1//secret",
      authorization: "Bearer x",
      event: { title: "Therapy appointment" },
      error: new Error("password=hunter2"),
    })
    vi.unstubAllEnvs()
    spy.mockRestore()
    const entry = JSON.parse(lines[0])
    expect(entry).toMatchObject({ level: "error", scope: "calendar:google", msg: "sync failed", kind: "rate-limited", accessToken: "[redacted]", refresh_token: "[redacted]", authorization: "[redacted]", event: "[object]", error: "Error" })
    expect(lines[0]).not.toMatch(/ya29|1\/\/secret|Therapy|hunter2/)
  })
})

describe("database migrations", () => {
  it("every migration applies cleanly to an empty database, in order (the test database is built from them)", async () => {
    const files = readdirSync("drizzle").filter((f) => f.endsWith(".sql")).sort()
    expect(files.length).toBeGreaterThanOrEqual(12)
    const applied = await t.client.query<{ n: number }>("select count(*)::int as n from drizzle.__drizzle_migrations")
    expect(applied.rows[0].n).toBe(files.length)
    // The indexes the reminder cleanup relies on exist.
    const indexes = await t.client.query<{ indexname: string }>("select indexname from pg_indexes where tablename = 'notifications'")
    expect(indexes.rows.map((r) => r.indexname)).toEqual(expect.arrayContaining(["notifications_related_task_idx", "notifications_related_session_idx"]))
  })
})

describe("imports are all-or-nothing", () => {
  it("a syllabus import that fails half-way leaves nothing behind (no course, no tasks)", async () => {
    const user = await t.addUser("Riley")
    const id = crypto.randomUUID()
    const task = (title: string) => ({ id, title, description: "", type: "assignment" as const, dueDate: "2026-10-09", priority: "medium" as const, estimateMinutes: 60, status: "not_started" as const })
    // The second task reuses the first one's id: the insert fails mid-import.
    await expect(
      saveSyllabusImport(t.db, user, {
        course: { kind: "new", fields: { code: "HIS210", name: "History", professor: "", description: "" } },
        tasks: [task("Essay 1"), task("Essay 2")],
        source: { fileName: "his210.pdf", itemsFound: 2 },
      })
    ).rejects.toThrow()
    const { eq } = await import("drizzle-orm")
    expect(await t.db.select().from(schema.courses).where(eq(schema.courses.userId, user))).toEqual([])
    expect(await t.db.select().from(schema.tasks).where(eq(schema.tasks.userId, user))).toEqual([])
    expect(await t.db.select().from(schema.syllabusImports).where(eq(schema.syllabusImports.userId, user))).toEqual([])
  })
})

describe("the Planner under a heavy, realistic load", () => {
  // 5 courses, 50 tasks, 5 weekly commitments, 60 events and 20 study sessions over 3 weeks.
  const courses: Course[] = ["CSC215", "MATH221", "PSY101", "ENG102", "BIO110"].map((code, i) => ({ id: `c${i}`, code, name: code, professor: "", description: "", color: "sky" }))
  const day = (n: number) => {
    const d = new Date(2026, 8, 21 + n)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
  }
  const types = ["assignment", "exam", "quiz", "project", "paper", "reading", "lab"] as const
  const priorities = ["low", "medium", "high", "critical"] as const
  const tasks: Task[] = Array.from({ length: 50 }, (_, i) => ({
    id: `t${i}`,
    courseId: `c${i % 5}`,
    title: `Task ${i}`,
    description: "",
    type: types[i % types.length],
    dueDate: day((i % 21) - 2),
    dueTime: i % 3 === 0 ? "23:59" : undefined,
    priority: priorities[i % 4],
    estimateMinutes: i % 7 === 0 ? null : 30 + (i % 8) * 30,
    status: i % 9 === 0 ? "completed" : i % 4 === 0 ? "in_progress" : "not_started",
  }))
  const recurringCommitments: RecurringCommitment[] = [
    { id: "r1", title: "CSC215", daysOfWeek: [1, 3, 5], startTime: "09:00", endTime: "09:50", type: "class" },
    { id: "r2", title: "MATH221", daysOfWeek: [2, 4], startTime: "11:00", endTime: "12:15", type: "class" },
    { id: "r3", title: "Soccer", daysOfWeek: [1, 2, 3, 4], startTime: "16:00", endTime: "18:00", type: "sports" },
    { id: "r4", title: "Job", daysOfWeek: [2, 6], startTime: "19:00", endTime: "22:00", type: "work" },
    { id: "r5", title: "Lab", daysOfWeek: [5], startTime: "13:00", endTime: "16:00", type: "class" },
  ]
  const events: CalendarEvent[] = Array.from({ length: 60 }, (_, i) => ({
    id: `e${i}`,
    title: `Event ${i}`,
    date: day(i % 21),
    startTime: `${String(8 + (i % 12)).padStart(2, "0")}:30`,
    endTime: `${String(9 + (i % 12)).padStart(2, "0")}:15`,
    type: "personal",
  }))
  const studySessions: StudySessionRecord[] = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    taskId: `t${i * 2}`,
    date: day(i % 7 - 3),
    startTime: "20:00",
    endTime: "21:00",
    status: i % 3 === 0 ? "completed" : "scheduled",
  }))
  const input = () =>
    plannerInputFor({ tasks, courses, events, studySessions, recurringCommitments, preferences: DEFAULT_STUDENT_PREFERENCES }, new Date(2026, 8, 24, 14, 30))

  it("plans two weeks fast, and the same input always gives the same plan (deterministic)", () => {
    const started = performance.now()
    const planner = createPlanner(input())
    const plans = Array.from({ length: 14 }, (_, i) => planner.planFor(day(3 + i)))
    const elapsed = performance.now() - started
    // Generous for slow CI machines; locally this is a small fraction of it.
    expect(elapsed).toBeLessThan(2_000)
    expect(plans.some((plan) => plan.suggestions.length > 0)).toBe(true)
    const again = createPlanner(input())
    expect(Array.from({ length: 14 }, (_, i) => again.planFor(day(3 + i)))).toEqual(plans)
  })

  it("'What should I do now?' stays quick with the same load", () => {
    const now = new Date(2026, 8, 24, 14, 30)
    const planner = createPlanner(input())
    const items = input().events
    const started = performance.now()
    const answer = whatNow({ planner, now, today: day(3), schedule: scheduleBetween(items, recurringCommitments, day(3), day(3)), events: items, tasks })
    expect(performance.now() - started).toBeLessThan(500)
    expect(answer.kind).toBeTruthy()
  })
})

describe("daylight saving time", () => {
  it("reminders fire at the student's local time on the day clocks change (New York, Nov 1 2026)", () => {
    // Study window starts 9:00 AM local: 13:00 UTC the day before (EDT), 14:00 UTC on Nov 1 (EST).
    expect(instantAt("2026-10-31", "09:00", "America/New_York").toISOString()).toBe("2026-10-31T13:00:00.000Z")
    expect(instantAt("2026-11-01", "09:00", "America/New_York").toISOString()).toBe("2026-11-01T14:00:00.000Z")
    const reminders = generateNotifications({
      now: new Date("2026-11-01T14:05:00Z"),
      timeZone: "America/New_York",
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
      studyStart: "09:00",
      tasks: [],
      studySessions: [],
      events: [],
      commitments: [],
      externalEvents: [],
      plan: { studySessions: 2, events: 1 },
    })
    const daily = reminders.find((r) => r.type === "daily_plan_ready")
    expect(daily?.scheduledFor.toISOString()).toBe("2026-11-01T14:00:00.000Z")
    // An hour earlier (13:05 UTC = 8:05 AM EST) it isn't due yet.
    const early = generateNotifications({ ...{ timeZone: "America/New_York", preferences: DEFAULT_NOTIFICATION_PREFERENCES, studyStart: "09:00", tasks: [], studySessions: [], events: [], commitments: [], externalEvents: [] }, now: new Date("2026-11-01T13:05:00Z"), plan: { studySessions: 2, events: 1 } })
    expect(early.some((r) => r.type === "daily_plan_ready")).toBe(false)
  })
})
