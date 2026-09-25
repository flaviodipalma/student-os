import { describe, expect, it } from "vitest"
import { AUTO_SYNC_GAP_MS, AUTO_SYNC_RETRY_MS, autoSyncCourses, INITIAL_AUTO_SYNC, shouldAutoSync, timeAgo } from "./auto-sync"
import { courseOptions } from "./courses"

const CANVAS = "https://school.instructure.com"
const NOW = Date.parse("2026-09-25T15:00:00Z")
const on = { ...INITIAL_AUTO_SYNC, enabled: true, canvasOrigin: CANVAS }

describe("shouldAutoSync", () => {
  it("syncs when Canvas opens and nothing synced recently", () => {
    expect(shouldAutoSync(on, `${CANVAS}/courses/215`, NOW)).toBe(true)
  })

  it("only with the switch on, only on the student's Canvas", () => {
    expect(shouldAutoSync({ ...on, enabled: false }, `${CANVAS}/`, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, canvasOrigin: null }, `${CANVAS}/`, NOW)).toBe(false)
    expect(shouldAutoSync(on, "https://other.instructure.com/", NOW)).toBe(false)
    expect(shouldAutoSync(on, "https://school.instructure.com.evil.example/", NOW)).toBe(false)
    expect(shouldAutoSync(on, "chrome://newtab/", NOW)).toBe(false)
    expect(shouldAutoSync(on, undefined, NOW)).toBe(false)
  })

  it("at most once every 30 minutes after a sync (by hand or automatic)", () => {
    expect(shouldAutoSync({ ...on, lastSuccessAt: NOW - 5 * 60_000 }, `${CANVAS}/`, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, lastSuccessAt: NOW - AUTO_SYNC_GAP_MS + 1 }, `${CANVAS}/`, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, lastSuccessAt: NOW - AUTO_SYNC_GAP_MS }, `${CANVAS}/`, NOW)).toBe(true)
  })

  it("after an attempt that didn't finish, waits a couple of minutes before trying again", () => {
    expect(shouldAutoSync({ ...on, lastAttemptAt: NOW - 30_000 }, `${CANVAS}/`, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, lastAttemptAt: NOW - AUTO_SYNC_RETRY_MS }, `${CANVAS}/`, NOW)).toBe(true)
  })
})

describe("autoSyncCourses", () => {
  const fall = { id: 11, name: "Fall 2026", start_at: "2026-08-25T04:00:00Z", end_at: "2026-12-20T05:00:00Z" }
  const options = courseOptions([
    { id: 215, name: "Data Structures", term: fall },
    { id: 300, name: "Calculus", term: fall },
    { id: 400, name: "Chemistry Lab", term: fall },
  ])

  it("exactly the saved choice", () => {
    expect(autoSyncCourses(options, { selected: ["215", "300"], seen: ["215", "300", "400"] })).toEqual({ ids: ["215", "300"], newCourses: false })
  })

  it("a course the student hasn't seen is reported, never added (even in the current semester)", () => {
    expect(autoSyncCourses(options, { selected: ["215"], seen: ["215", "300"] })).toEqual({ ids: ["215"], newCourses: true })
  })

  it("courses no longer in Canvas drop out; no saved choice means no automatic sync", () => {
    expect(autoSyncCourses(options, { selected: ["215", "999"], seen: ["215", "300", "400", "999"] })?.ids).toEqual(["215"])
    expect(autoSyncCourses(options, null)).toBeNull()
  })
})

describe("timeAgo", () => {
  it("reads naturally", () => {
    expect(timeAgo(NOW - 20_000, NOW)).toBe("just now")
    expect(timeAgo(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago")
    expect(timeAgo(NOW - 60 * 60_000, NOW)).toBe("1 hour ago")
    expect(timeAgo(NOW - 50 * 60 * 60_000, NOW)).toBe("2 days ago")
  })
})
