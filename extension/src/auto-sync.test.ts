import { describe, expect, it } from "vitest"
import {
  AUTO_SYNC_GAP_MS,
  AUTO_SYNC_RETRY_MS,
  autoSyncCourses,
  badgeFor,
  INITIAL_AUTO_SYNC,
  migrateAutoSync,
  newSite,
  shouldAutoSync,
  siteFor,
  timeAgo,
} from "./auto-sync"
import { courseOptions } from "./courses"

const CANVAS = "https://school.instructure.com"
const BLACKBOARD = "https://school.blackboard.com"
const NOW = Date.parse("2026-09-25T15:00:00Z")
const on = { ...newSite("canvas"), enabled: true }

describe("siteFor", () => {
  const state = { sites: { [CANVAS]: on, [BLACKBOARD]: newSite("blackboard") }, loggedOut: false }

  it("finds the site a page belongs to, by exact origin", () => {
    expect(siteFor(state, `${CANVAS}/courses/215`)).toEqual({ origin: CANVAS, site: on })
    expect(siteFor(state, `${BLACKBOARD}/ultra/course`)?.site.lms).toBe("blackboard")
  })

  it("nothing for other sites or odd addresses", () => {
    expect(siteFor(state, "https://other.instructure.com/")).toBeNull()
    expect(siteFor(state, "https://school.instructure.com.evil.example/")).toBeNull()
    expect(siteFor(state, "chrome://newtab/")).toBeNull()
    expect(siteFor(state, undefined)).toBeNull()
    expect(siteFor({ sites: {}, loggedOut: false }, "https://__proto__/")).toBeNull()
  })
})

describe("shouldAutoSync", () => {
  it("syncs a site with the switch on, when nothing synced recently", () => {
    expect(shouldAutoSync(on, NOW)).toBe(true)
    expect(shouldAutoSync({ ...on, enabled: false }, NOW)).toBe(false)
    expect(shouldAutoSync(undefined, NOW)).toBe(false)
  })

  it("at most once every 30 minutes after a sync (by hand or automatic)", () => {
    expect(shouldAutoSync({ ...on, lastSuccessAt: NOW - 5 * 60_000 }, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, lastSuccessAt: NOW - AUTO_SYNC_GAP_MS + 1 }, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, lastSuccessAt: NOW - AUTO_SYNC_GAP_MS }, NOW)).toBe(true)
  })

  it("after an attempt that didn't finish, waits a couple of minutes before trying again", () => {
    expect(shouldAutoSync({ ...on, lastAttemptAt: NOW - 30_000 }, NOW)).toBe(false)
    expect(shouldAutoSync({ ...on, lastAttemptAt: NOW - AUTO_SYNC_RETRY_MS }, NOW)).toBe(true)
  })
})

describe("migrateAutoSync", () => {
  it("carries the single-Canvas settings (before Blackboard) over", () => {
    const old = { enabled: true, canvasOrigin: CANVAS, lastAttemptAt: 1, lastSuccessAt: 2, lastAutomatic: true, problem: "new-courses" }
    expect(migrateAutoSync(old)).toEqual({
      sites: { [CANVAS]: { lms: "canvas", enabled: true, lastAttemptAt: 1, lastSuccessAt: 2, lastAutomatic: true, newCourses: true } },
      loggedOut: false,
    })
    expect(migrateAutoSync({ ...old, problem: "logged-out" }).loggedOut).toBe(true)
    expect(migrateAutoSync({ enabled: false, canvasOrigin: null })).toEqual(INITIAL_AUTO_SYNC)
  })

  it("today's shape stays as it is; nothing stored is a fresh start", () => {
    const state = { sites: { [BLACKBOARD]: newSite("blackboard") }, loggedOut: true }
    expect(migrateAutoSync(state)).toEqual(state)
    expect(migrateAutoSync(undefined)).toEqual(INITIAL_AUTO_SYNC)
  })
})

describe("badgeFor", () => {
  it("'!' when logged out of Student OS, 'New' when any site has new courses, else nothing", () => {
    expect(badgeFor({ sites: { [CANVAS]: { ...on, newCourses: true } }, loggedOut: true })).toBe("!")
    expect(badgeFor({ sites: { [CANVAS]: on, [BLACKBOARD]: { ...newSite("blackboard"), newCourses: true } }, loggedOut: false })).toBe("New")
    expect(badgeFor({ sites: { [CANVAS]: on }, loggedOut: false })).toBe("")
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

  it("courses no longer listed drop out; no saved choice means no automatic sync", () => {
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
