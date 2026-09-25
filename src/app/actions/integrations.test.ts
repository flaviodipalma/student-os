import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { syncExternalCalendar } from "@/server/integrations/calendar/calendar-sync"
import { listLmsConnections, saveLmsExtensionConnection } from "@/server/integrations/lms/connections"
import { listExternalEvents } from "@/server/services/external-events"
import { listCourses } from "@/server/services/courses"
import { createTestDb } from "@/server/test-utils/test-db"
import { importCanvasFromExtension } from "@/server/integrations/extension/canvas-import"

// The integration server actions, as the browser calls them: disconnecting Canvas
// or Blackboard (connecting and syncing happen in the browser extension) and hiding
// calendar events. The signed-in student comes from the (mocked) verified session,
// never from the request.

const session = vi.hoisted(() => ({ userId: null as string | null, db: null as unknown }))
vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => (session.userId ? { id: session.userId, email: null } : null),
}))
vi.mock("@/server/db", () => ({ getDb: () => session.db }))

const { disconnectLmsAction, lmsSyncStatusAction, setExternalEventHiddenAction } = await import("./integrations")

const BASE = "https://school.instructure.com"

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  session.db = t.db as Database
})
afterEach(() => {
  session.userId = null
  return t.close()
})

async function connectedStudent(name: string) {
  const user = await t.addUser(name)
  await saveLmsExtensionConnection(t.db, user, "canvas", BASE)
  return user
}

describe("disconnecting Canvas or Blackboard", () => {
  it("refuses when nobody is signed in", async () => {
    expect(await disconnectLmsAction("canvas")).toMatchObject({ ok: false, code: "unauthorized" })
  })

  it("removes the connection but keeps imported courses and tasks", async () => {
    const user = await connectedStudent("Alice")
    await importCanvasFromExtension(t.db, user, {
      baseUrl: BASE,
      courses: [{ id: 215, name: "Data Structures", course_code: "CSC 215" }],
      assignments: { "215": [{ id: 1, name: "Project 1", due_at: "2026-10-02T03:59:00Z", published: true }] },
    })
    session.userId = user
    expect(await disconnectLmsAction("canvas")).toEqual({ ok: true, data: null })
    expect(await listLmsConnections(t.db, user)).toEqual([])
    expect(await listCourses(t.db, user)).toHaveLength(1)
  })

  it("can't disconnect another student's connection, or an unknown LMS", async () => {
    const alice = await connectedStudent("Alice")
    session.userId = await t.addUser("Bob")
    expect(await disconnectLmsAction("canvas")).toMatchObject({ ok: false, code: "not-found" })
    expect(await disconnectLmsAction("moodle")).toMatchObject({ ok: false, code: "validation" })
    expect(await listLmsConnections(t.db, alice)).toHaveLength(1)
  })
})

describe("waiting for the first sync (onboarding)", () => {
  it("nothing yet, then the sync time and the number of that LMS's courses", async () => {
    const user = await t.addUser("Alice")
    session.userId = user
    expect(await lmsSyncStatusAction("canvas")).toEqual({ ok: true, data: { syncedAt: null, courses: 0 } })
    await importCanvasFromExtension(t.db, user, {
      baseUrl: BASE,
      courses: [{ id: 215, name: "Data Structures", course_code: "CSC 215" }, { id: 216, name: "Calculus", course_code: "MAT 141" }],
      assignments: { "215": [], "216": [] },
    })
    const status = await lmsSyncStatusAction("canvas")
    expect(status).toMatchObject({ ok: true, data: { syncedAt: expect.any(String), courses: 2 } })
    expect(await lmsSyncStatusAction("blackboard")).toEqual({ ok: true, data: { syncedAt: null, courses: 0 } })
  })

  it("only the signed-in student's own status; bad input refused", async () => {
    const alice = await t.addUser("Alice")
    await importCanvasFromExtension(t.db, alice, { baseUrl: BASE, courses: [{ id: 215, name: "Data Structures" }], assignments: { "215": [] } })
    expect(await lmsSyncStatusAction("canvas")).toMatchObject({ ok: false, code: "unauthorized" })
    session.userId = await t.addUser("Bob")
    expect(await lmsSyncStatusAction("canvas")).toEqual({ ok: true, data: { syncedAt: null, courses: 0 } })
    expect(await lmsSyncStatusAction("moodle")).toMatchObject({ ok: false, code: "validation" })
  })
})

describe("External calendar events", () => {
  async function withEvent(name: string, source: "google" | "canvas" = "google") {
    const user = await connectedStudent(name)
    await syncExternalCalendar(
      t.db,
      user,
      source,
      [
        {
          source,
          externalId: "event-9",
          title: "CSC215 Exam",
          description: null,
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
          location: null,
          url: null,
        },
      ],
      { now: new Date() }
    )
    const [event] = await listExternalEvents(t.db, user)
    return { user, event }
  }

  it("the signed-in student hides and restores their own event", async () => {
    const { user, event } = await withEvent("Alice")
    session.userId = user
    expect(await setExternalEventHiddenAction(event.id, true)).toMatchObject({ ok: true, data: { id: event.id, hidden: true } })
    expect(await setExternalEventHiddenAction(event.id, false)).toMatchObject({ ok: true, data: { hidden: false } })
  })

  it("nobody else can hide it, and bad input is refused", async () => {
    const { user, event } = await withEvent("Alice")
    expect(await setExternalEventHiddenAction(event.id, true)).toMatchObject({ ok: false, code: "unauthorized" })
    session.userId = await t.addUser("Bob")
    expect(await setExternalEventHiddenAction(event.id, true)).toMatchObject({ ok: false, code: "not-found" })
    expect(await setExternalEventHiddenAction("not-a-uuid", true)).toMatchObject({ ok: false, code: "validation" })
    expect(await setExternalEventHiddenAction(event.id, "yes")).toMatchObject({ ok: false, code: "validation" })
    expect((await listExternalEvents(t.db, user))[0].hidden).toBe(false)
  })

  it("disconnecting Canvas stops showing any Canvas calendar events left from before", async () => {
    const { user } = await withEvent("Alice", "canvas")
    session.userId = user
    expect(await disconnectLmsAction("canvas")).toEqual({ ok: true, data: null })
    expect(await listExternalEvents(t.db, user)).toEqual([])
  })
})
