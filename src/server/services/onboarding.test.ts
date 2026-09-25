import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { RecurringCommitmentInput } from "@/lib/types"
import {
  createCommitmentSchema,
  onboardingDetailsSchema,
  preferencesSchema,
  profileSchema,
  updateCommitmentSchema,
} from "@/lib/validation"
import { recurringCommitments } from "../db/schema"
import { NotFoundError, toAppError } from "../errors"
import { createTestDb } from "../test-utils/test-db"
import { loadAppData } from "./app-data"
import { saveOnboardingDetails } from "./onboarding"
import { getPreferences, savePreferences } from "./preferences"
import { completeOnboarding, getProfile, updateProfile } from "./profiles"
import {
  createRecurringCommitment,
  deleteRecurringCommitment,
  listRecurringCommitments,
  updateRecurringCommitment,
} from "./recurring-commitments"

// Onboarding, preferences and weekly commitments against a real Postgres (PGlite).

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
})
afterEach(() => t.close())

const practice: RecurringCommitmentInput = {
  title: "Soccer Practice",
  daysOfWeek: [2, 4],
  startTime: "10:30",
  endTime: "13:00",
  type: "sports",
}

const profile = { firstName: "Flavio", lastName: "Di Palma", schoolName: "Quinnipiac University", schoolDomain: "qu.edu" }

describe("onboarding", () => {
  it("a new student hasn't onboarded yet and starts with the default preferences", async () => {
    const user = await t.addUser("")
    const data = await loadAppData(t.db, user)
    expect(data.student.onboardingCompleted).toBe(false)
    expect(data.preferences).toEqual(DEFAULT_STUDENT_PREFERENCES)
    expect(data.recurringCommitments).toEqual([])
  })

  it("saves profile, preferences and weekly commitments together, then completes", async () => {
    const user = await t.addUser("")
    const preferences = { ...DEFAULT_STUDENT_PREFERENCES, studyStart: "09:00", preferredBlockMinutes: 45 }

    await saveOnboardingDetails(t.db, user, { profile, preferences, commitments: [practice] })
    expect((await getProfile(t.db, user)).onboardingCompleted).toBe(false) // not until Finish
    await completeOnboarding(t.db, user)

    const data = await loadAppData(t.db, user)
    expect(data.student).toEqual({ ...profile, onboardingCompleted: true })
    expect(data.preferences).toEqual(preferences)
    expect(data.recurringCommitments).toEqual([expect.objectContaining(practice)])
  })

  it("saving onboarding again replaces the weekly schedule instead of duplicating it", async () => {
    const user = await t.addUser()
    const details = { profile, preferences: DEFAULT_STUDENT_PREFERENCES, commitments: [practice] }
    await saveOnboardingDetails(t.db, user, details)
    await saveOnboardingDetails(t.db, user, { ...details, commitments: [{ ...practice, title: "Practice" }] })
    expect((await listRecurringCommitments(t.db, user)).map((c) => c.title)).toEqual(["Practice"])
  })

  it("saves nothing if any part is invalid", async () => {
    const user = await t.addUser("Orig")
    const bad = { ...practice, startTime: "15:00", endTime: "14:00" } // the database refuses this
    await expect(
      saveOnboardingDetails(t.db, user, { profile, preferences: DEFAULT_STUDENT_PREFERENCES, commitments: [bad] })
    ).rejects.toBeTruthy()
    expect((await getProfile(t.db, user)).firstName).toBe("Orig")
    expect(await listRecurringCommitments(t.db, user)).toEqual([])
  })
})

describe("preferences", () => {
  it("can be saved and updated", async () => {
    const user = await t.addUser()
    await savePreferences(t.db, user, { ...DEFAULT_STUDENT_PREFERENCES, maxStudyMinutesPerDay: 180 })
    const updated = await savePreferences(t.db, user, {
      ...DEFAULT_STUDENT_PREFERENCES,
      maxStudyMinutesPerDay: 120,
      studyEnd: "20:00",
    })
    expect(updated).toMatchObject({ maxStudyMinutesPerDay: 120, studyEnd: "20:00" })
    expect(await getPreferences(t.db, user)).toEqual(updated)
  })

  it("the database refuses impossible values", async () => {
    const user = await t.addUser()
    const attempts = [
      { ...DEFAULT_STUDENT_PREFERENCES, studyStart: "22:00", studyEnd: "08:00" },
      { ...DEFAULT_STUDENT_PREFERENCES, maxStudyMinutesPerDay: 0 },
      { ...DEFAULT_STUDENT_PREFERENCES, preferredBlockMinutes: 50 },
    ]
    for (const attempt of attempts) {
      const error = await savePreferences(t.db, user, attempt).catch((e) => e)
      expect(toAppError(error).code).toBe("validation")
    }
  })

  it("input rules explain what's wrong", () => {
    const check = (value: unknown) => {
      const result = preferencesSchema.safeParse(value)
      return result.success ? "ok" : result.error.issues[0].message
    }
    expect(check(DEFAULT_STUDENT_PREFERENCES)).toBe("ok")
    expect(check({ ...DEFAULT_STUDENT_PREFERENCES, studyStart: "20:00", studyEnd: "18:00" })).toBe(
      "Your study window must end after it starts."
    )
    expect(check({ ...DEFAULT_STUDENT_PREFERENCES, studyStart: "20:00", studyEnd: "20:30" })).toBe(
      "Make your study window at least an hour long."
    )
    expect(check({ ...DEFAULT_STUDENT_PREFERENCES, maxStudyMinutesPerDay: -30 })).toBe(
      "Plan at least 15 minutes of study a day."
    )
    expect(check({ ...DEFAULT_STUDENT_PREFERENCES, preferredBlockMinutes: 50 })).toBe(
      "Pick a study session length of 30, 45, 60 or 90 minutes."
    )
    expect(profileSchema.safeParse({ ...profile, firstName: "  " }).success).toBe(false)
    expect(onboardingDetailsSchema.safeParse({ profile, preferences: DEFAULT_STUDENT_PREFERENCES, commitments: [] }).success).toBe(true)
  })
})

describe("weekly commitments", () => {
  it("can be created, edited and deleted", async () => {
    const user = await t.addUser()
    const created = await createRecurringCommitment(t.db, user, practice)
    const edited = await updateRecurringCommitment(t.db, user, created.id, { daysOfWeek: [1, 3, 5], endTime: "12:30" })
    expect(edited).toMatchObject({ daysOfWeek: [1, 3, 5], startTime: "10:30", endTime: "12:30" })
    await deleteRecurringCommitment(t.db, user, created.id)
    expect(await listRecurringCommitments(t.db, user)).toEqual([])
  })

  it("reject invalid time ranges and days", async () => {
    const user = await t.addUser()
    const base = { ...practice, id: crypto.randomUUID() }
    const check = (value: unknown) => {
      const result = createCommitmentSchema.safeParse(value)
      return result.success ? "ok" : result.error.issues[0].message
    }
    expect(check(base)).toBe("ok")
    expect(check({ ...base, startTime: "13:00", endTime: "10:30" })).toBe("End time must be after the start time.")
    expect(check({ ...base, daysOfWeek: [] })).toBe("Pick at least one day.")
    expect(check({ ...base, daysOfWeek: [1, 1] })).toBe("Each day can only be picked once.")
    expect(check({ ...base, daysOfWeek: [7] })).not.toBe("ok")
    expect(check({ ...base, title: " " })).toBe("Give the commitment a name.")
    expect(check({ ...base, type: "party" })).not.toBe("ok")

    // The database has the same rules as a second line of defence.
    await expect(t.db.insert(recurringCommitments).values({ ...practice, userId: user, daysOfWeek: [7] })).rejects.toBeTruthy()
    await expect(t.db.insert(recurringCommitments).values({ ...practice, userId: user, daysOfWeek: [] })).rejects.toBeTruthy()
    await expect(
      createRecurringCommitment(t.db, user, { ...practice, startTime: "13:00", endTime: "10:30" })
    ).rejects.toBeTruthy()
  })
})

describe("repeating events (weekly commitments with dates)", () => {
  const term = { ...practice, description: "Field 3", startDate: "2026-09-01", endDate: "2026-12-12" }

  it("saves and returns the description and date range", async () => {
    const user = await t.addUser()
    const created = await createRecurringCommitment(t.db, user, term)
    expect(created).toEqual({ ...term, id: created.id })
    expect(await listRecurringCommitments(t.db, user)).toEqual([created])
  })

  it("editing the series updates the one stored rule, and null clears optional fields", async () => {
    const user = await t.addUser()
    const created = await createRecurringCommitment(t.db, user, term)
    const edited = await updateRecurringCommitment(t.db, user, created.id, {
      title: "Soccer (fall)",
      endDate: null,
      description: null,
    })
    expect(edited).toEqual({ ...practice, id: created.id, title: "Soccer (fall)", startDate: "2026-09-01" })
    expect(await listRecurringCommitments(t.db, user)).toHaveLength(1)
  })

  it("deleting the series removes every week at once", async () => {
    const user = await t.addUser()
    const created = await createRecurringCommitment(t.db, user, term)
    await deleteRecurringCommitment(t.db, user, created.id)
    expect(await listRecurringCommitments(t.db, user)).toEqual([])
    await expect(deleteRecurringCommitment(t.db, user, created.id)).rejects.toBeInstanceOf(NotFoundError)
  })

  it("rejects an end date before the start date", async () => {
    const user = await t.addUser()
    const check = (value: unknown) => {
      const result = createCommitmentSchema.safeParse({ ...value as object, id: crypto.randomUUID() })
      return result.success ? "ok" : result.error.issues[0].message
    }
    expect(check(term)).toBe("ok")
    expect(check({ ...term, endDate: "2026-08-01" })).toBe("The end date can't be before the start date.")
    expect(check({ ...term, endDate: term.startDate })).toBe("ok") // a single day is fine
    expect(check({ ...term, startDate: "2026-02-30" })).toBe("Use a valid date.")
    expect(updateCommitmentSchema.safeParse({ startDate: "2026-12-01", endDate: "2026-11-01" }).success).toBe(false)

    // An edit that moves only one side is checked against the saved other side.
    const created = await createRecurringCommitment(t.db, user, term)
    await expect(
      updateRecurringCommitment(t.db, user, created.id, { endDate: "2026-08-01" })
    ).rejects.toMatchObject({ code: "validation" })
    await expect(
      updateRecurringCommitment(t.db, user, created.id, { startTime: "14:00" })
    ).rejects.toMatchObject({ code: "validation" })

    // And the database refuses it too.
    await expect(
      t.db.insert(recurringCommitments).values({ ...term, userId: user, endDate: "2026-08-01" })
    ).rejects.toBeTruthy()
  })

  it("commitments from onboarding show up in the app data like any other", async () => {
    const user = await t.addUser()
    await saveOnboardingDetails(t.db, user, { profile, preferences: DEFAULT_STUDENT_PREFERENCES, commitments: [practice] })
    await createRecurringCommitment(t.db, user, { ...term, title: "Library shift", type: "work" })
    const data = await loadAppData(t.db, user)
    expect(data.recurringCommitments.map((c) => c.title).sort()).toEqual(["Library shift", "Soccer Practice"])
  })

  it("another student can't edit or delete them", async () => {
    const alice = await t.addUser("Alice")
    const bob = await t.addUser("Bob")
    const alices = await createRecurringCommitment(t.db, alice, term)
    await expect(updateRecurringCommitment(t.db, bob, alices.id, { endDate: null })).rejects.toBeInstanceOf(NotFoundError)
    await expect(deleteRecurringCommitment(t.db, bob, alices.id)).rejects.toBeInstanceOf(NotFoundError)
    expect(await listRecurringCommitments(t.db, alice)).toEqual([alices])
  })
})

describe("user isolation", () => {
  it("a student can't see, change or delete another student's preferences or commitments", async () => {
    const alice = await t.addUser("Alice")
    const bob = await t.addUser("Bob")
    await savePreferences(t.db, alice, { ...DEFAULT_STUDENT_PREFERENCES, maxStudyMinutesPerDay: 90 })
    const alicesPractice = await createRecurringCommitment(t.db, alice, practice)

    const bobs = await loadAppData(t.db, bob)
    expect(bobs.preferences).toEqual(DEFAULT_STUDENT_PREFERENCES)
    expect(bobs.recurringCommitments).toEqual([])
    await expect(updateRecurringCommitment(t.db, bob, alicesPractice.id, { title: "Hacked" })).rejects.toBeInstanceOf(
      NotFoundError
    )
    await expect(deleteRecurringCommitment(t.db, bob, alicesPractice.id)).rejects.toBeInstanceOf(NotFoundError)

    // Bob replacing his own schedule leaves Alice's alone.
    await saveOnboardingDetails(t.db, bob, { profile: { ...profile, firstName: "Bob" }, preferences: DEFAULT_STUDENT_PREFERENCES, commitments: [] })
    const alices = await loadAppData(t.db, alice)
    expect(alices.recurringCommitments).toEqual([alicesPractice])
    expect(alices.preferences.maxStudyMinutesPerDay).toBe(90)
    expect(alices.student.firstName).toBe("Alice")
  })

  it("updating a profile only changes your own", async () => {
    const alice = await t.addUser("Alice")
    const bob = await t.addUser("Bob")
    await updateProfile(t.db, bob, { ...profile, firstName: "Robert" })
    expect((await getProfile(t.db, alice)).firstName).toBe("Alice")
    expect((await getProfile(t.db, bob)).firstName).toBe("Robert")
  })
})
