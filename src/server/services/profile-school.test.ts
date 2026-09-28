import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"
import { profileSchema } from "@/lib/validation"
import { profiles } from "../db/schema"
import { createTestDb } from "../test-utils/test-db"
import { getProfile, updateProfile } from "./profiles"

// The profile's school (which replaced the term and year in school), against a real Postgres.

let t: Awaited<ReturnType<typeof createTestDb>>
beforeAll(async () => {
  t = await createTestDb()
})
afterAll(() => t.close())

const valid = (input: Record<string, unknown>) => profileSchema.parse({ firstName: "Alex", lastName: "", ...input })

describe("the school on a profile", () => {
  it("saves the school picked from the list, with its web domain", async () => {
    const alex = await t.addUser("Alex")
    await updateProfile(t.db, alex, valid({ schoolName: "Quinnipiac University", schoolDomain: "qu.edu" }))
    expect(await getProfile(t.db, alex)).toMatchObject({ schoolName: "Quinnipiac University", schoolDomain: "qu.edu" })
  })

  it("a school is required, with its website; a website typed in full is reduced to its domain", async () => {
    const alex = await t.addUser("Alex")
    await updateProfile(t.db, alex, valid({ schoolName: "My Community College", schoolDomain: "https://www.MyCC.edu/admissions?x=1" }))
    expect(await getProfile(t.db, alex)).toMatchObject({ schoolName: "My Community College", schoolDomain: "mycc.edu" })
    expect(profileSchema.safeParse({ firstName: "Alex", schoolName: "", schoolDomain: "qu.edu" }).error?.issues[0].message).toBe("Pick your school.")
    expect(profileSchema.safeParse({ firstName: "Alex", schoolName: "My Community College" }).error?.issues[0].message).toMatch(/Add your school's website/)
    expect(profileSchema.safeParse({ firstName: "Alex", schoolName: "My Community College", schoolDomain: "" }).success).toBe(false)
  })

  it("bad websites and names are refused", () => {
    expect(valid({ schoolName: "Quinnipiac University", schoolDomain: " QU.EDU " }).schoolDomain).toBe("qu.edu")
    for (const bad of ["qu", "<script>.edu", "not a website", "qu..edu!"]) {
      expect(profileSchema.safeParse({ firstName: "Alex", schoolName: "X", schoolDomain: bad }).success, bad).toBe(false)
    }
    expect(profileSchema.safeParse({ firstName: "Alex", schoolName: "x".repeat(201), schoolDomain: "qu.edu" }).success).toBe(false)
  })

  it("the database refuses a malformed domain even if the checks above were skipped", async () => {
    const alex = await t.addUser("Alex")
    await expect(t.db.update(profiles).set({ schoolName: "X", schoolDomain: "not a domain" }).where(eq(profiles.id, alex))).rejects.toThrow()
    await expect(t.db.update(profiles).set({ schoolName: "X", schoolDomain: "quxedu" }).where(eq(profiles.id, alex))).rejects.toThrow()
    await expect(t.db.update(profiles).set({ schoolName: "X", schoolDomain: "qu.edu" }).where(eq(profiles.id, alex))).resolves.toBeDefined()
  })
})
