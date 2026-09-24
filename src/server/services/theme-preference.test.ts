import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createTestDb } from "../test-utils/test-db"
import { getPreferences, getThemePreference, saveThemePreference } from "./preferences"

// The saved Light / Dark / System choice (one column on the preferences row).

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

describe("theme preference", () => {
  it("null until chosen; saved per student; study preferences untouched", async () => {
    const alex = await t.addUser("Alex")
    const bob = await t.addUser("Bob")
    expect(await getThemePreference(t.db, alex)).toBeNull()
    await saveThemePreference(t.db, alex, "dark")
    expect(await getThemePreference(t.db, alex)).toBe("dark")
    expect(await getThemePreference(t.db, bob)).toBeNull()
    await saveThemePreference(t.db, alex, "system")
    expect(await getThemePreference(t.db, alex)).toBe("system")
    expect((await getPreferences(t.db, alex)).maxStudyMinutesPerDay).toBe(240)
  })
})
