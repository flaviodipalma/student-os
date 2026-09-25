// When the extension syncs on its own (the student opened Canvas or Blackboard),
// and which courses it syncs. Kept per school site (a student can have Canvas and
// Blackboard). No Chrome APIs here (tested in Node).
import type { CourseChoice, CourseOption } from "./courses"

export type LmsId = "canvas" | "blackboard"
export const LMS_NAMES: Record<LmsId, string> = { canvas: "Canvas", blackboard: "Blackboard" }

// At most one automatic sync per half hour per site (Canvas and Blackboard load a
// new page on every click; Student OS allows 20 syncs an hour). Sync now in the
// popup works any time.
export const AUTO_SYNC_GAP_MS = 30 * 60_000
// After an attempt that didn't finish (logged out, offline), wait a little before
// trying again, so clicking around doesn't retry on every page.
export const AUTO_SYNC_RETRY_MS = 2 * 60_000

// One school site (its origin, e.g. https://school.instructure.com), known once the
// student has synced it by hand.
export type SiteSync = {
  lms: LmsId
  enabled: boolean
  lastAttemptAt: number | null
  // Any successful sync, automatic or by hand.
  lastSuccessAt: number | null
  lastAutomatic: boolean
  // Courses the student hasn't seen yet (the popup asks; automatic sync never adds them).
  newCourses: boolean
}

// Kept in chrome.storage.local (this computer only).
export type AutoSyncState = {
  sites: Record<string, SiteSync>
  // Nobody logged in to Student OS when an automatic sync tried.
  loggedOut: boolean
}

export const INITIAL_AUTO_SYNC: AutoSyncState = { sites: {}, loggedOut: false }

export const newSite = (lms: LmsId): SiteSync => ({
  lms,
  enabled: false,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastAutomatic: false,
  newCourses: false,
})

// What's stored, in today's shape. Before Blackboard it was one Canvas site:
// { enabled, canvasOrigin, lastAttemptAt, lastSuccessAt, lastAutomatic, problem }.
export function migrateAutoSync(stored: unknown): AutoSyncState {
  if (typeof stored !== "object" || stored === null) return INITIAL_AUTO_SYNC
  const value = stored as Record<string, unknown>
  if (typeof value.sites === "object" && value.sites !== null) {
    return { sites: value.sites as Record<string, SiteSync>, loggedOut: value.loggedOut === true }
  }
  const origin = typeof value.canvasOrigin === "string" ? value.canvasOrigin : null
  const number = (key: string) => (typeof value[key] === "number" ? (value[key] as number) : null)
  return {
    sites: origin
      ? {
          [origin]: {
            lms: "canvas",
            enabled: value.enabled === true,
            lastAttemptAt: number("lastAttemptAt"),
            lastSuccessAt: number("lastSuccessAt"),
            lastAutomatic: value.lastAutomatic === true,
            newCourses: value.problem === "new-courses",
          },
        }
      : {},
    loggedOut: value.problem === "logged-out",
  }
}

// The known site a page belongs to (exact origin), or null.
export function siteFor(state: AutoSyncState, url: string | undefined): { origin: string; site: SiteSync } | null {
  if (!url) return null
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return null
  }
  const site = Object.hasOwn(state.sites, origin) ? state.sites[origin] : undefined
  return site ? { origin, site } : null
}

export function shouldAutoSync(site: SiteSync | undefined, now: number): boolean {
  if (!site?.enabled) return false
  if (site.lastSuccessAt !== null && now - site.lastSuccessAt < AUTO_SYNC_GAP_MS) return false
  if (site.lastAttemptAt !== null && now - site.lastAttemptAt < AUTO_SYNC_RETRY_MS) return false
  return true
}

// The badge on the extension icon: only when something needs the student.
export function badgeFor(state: AutoSyncState): "!" | "New" | "" {
  if (state.loggedOut) return "!"
  return Object.values(state.sites).some((site) => site.newCourses) ? "New" : ""
}

// The courses an automatic sync reads: exactly the student's saved choice (never
// picks courses for them). A course they haven't seen yet is only reported, so the
// popup can ask. Null when they haven't chosen yet (the first sync is by hand).
export function autoSyncCourses(options: CourseOption[], saved: CourseChoice | null): { ids: string[]; newCourses: boolean } | null {
  if (!saved) return null
  const seen = new Set(saved.seen)
  const chosen = new Set(saved.selected)
  return {
    ids: options.map((o) => o.id).filter((id) => chosen.has(id)),
    newCourses: options.some((o) => !seen.has(o.id)),
  }
}

// "5 minutes ago" for the popup.
export function timeAgo(then: number, now: number): string {
  const minutes = Math.floor((now - then) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  const days = Math.floor(hours / 24)
  return `${days} ${days === 1 ? "day" : "days"} ago`
}
