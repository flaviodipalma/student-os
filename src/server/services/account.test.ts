import { eq } from "drizzle-orm"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { calendarConnections, courses, profiles } from "../db/schema"
import { createTestDb } from "../test-utils/test-db"
import { accountExists, deleteAccount } from "./account"
import { createCourse } from "./courses"

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const authUser = async (id: string) => (await t.client.query("select id from auth.users where id = $1", [id])).rows.length

describe("deleting an account", () => {
  it("removes the login and everything the student had, revokes calendars first, and leaves other students alone", async () => {
    const alex = await t.addUser("Alex")
    const bob = await t.addUser("Bob")
    await createCourse(t.db, alex, { code: "CSC215", name: "Database Systems", professor: "", description: "" })
    await createCourse(t.db, bob, { code: "PSY101", name: "Intro to Psychology", professor: "", description: "" })
    await t.db.insert(calendarConnections).values({ userId: alex, provider: "google", accessTokenEncrypted: "sealed" })

    const revoke = vi.fn(async () => {})
    expect(await deleteAccount(t.db, alex, revoke)).toBe(true)

    expect(revoke).toHaveBeenCalledExactlyOnceWith("google")
    expect(await authUser(alex)).toBe(0)
    expect(await t.db.select().from(profiles).where(eq(profiles.id, alex))).toEqual([])
    expect(await t.db.select().from(courses).where(eq(courses.userId, alex))).toEqual([])
    expect(await t.db.select().from(calendarConnections).where(eq(calendarConnections.userId, alex))).toEqual([])
    expect(await authUser(bob)).toBe(1)
    expect(await t.db.select().from(courses).where(eq(courses.userId, bob))).toHaveLength(1)
  })

  it("a calendar that can't be revoked doesn't stop the deletion", async () => {
    const riley = await t.addUser("Riley")
    await t.db.insert(calendarConnections).values({ userId: riley, provider: "outlook", accessTokenEncrypted: "sealed" })
    expect(await deleteAccount(t.db, riley, async () => Promise.reject(new Error("provider down")))).toBe(true)
    expect(await authUser(riley)).toBe(0)
  })

  it("an account that doesn't exist (or was already deleted) reports false", async () => {
    expect(await deleteAccount(t.db, crypto.randomUUID(), async () => {})).toBe(false)
  })

  it("tells whether the account behind a session still exists", async () => {
    const kim = await t.addUser("Kim")
    expect(await accountExists(t.db, kim)).toBe(true)
    await deleteAccount(t.db, kim, async () => {})
    expect(await accountExists(t.db, kim)).toBe(false)
  })
})
