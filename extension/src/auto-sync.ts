// When the extension syncs Canvas on its own (the student opened Canvas), and which
// courses it syncs. No Chrome APIs here (tested in Node).
import type { CourseChoice, CourseOption } from "./courses"

// At most one automatic sync per half hour (Canvas loads a new page on every click;
// Student OS allows 20 syncs an hour). Sync now in the popup works any time.
export const AUTO_SYNC_GAP_MS = 30 * 60_000
// After an attempt that didn't finish (logged out, offline), wait a little before
// trying again, so clicking around Canvas doesn't retry on every page.
export const AUTO_SYNC_RETRY_MS = 2 * 60_000

// Kept in chrome.storage.local (this computer only).
export type AutoSyncState = {
  enabled: boolean
  // The Canvas the student synced by hand (its origin, e.g. https://school.instructure.com).
  canvasOrigin: string | null
  lastAttemptAt: number | null
  // Any successful sync, automatic or by hand.
  lastSuccessAt: number | null
  lastAutomatic: boolean
  // What the popup should point out, shown as a badge on the extension icon.
  problem: "logged-out" | "new-courses" | null
}

export const INITIAL_AUTO_SYNC: AutoSyncState = {
  enabled: false,
  canvasOrigin: null,
  lastAttemptAt: null,
  lastSuccessAt: null,
  lastAutomatic: false,
  problem: null,
}

export function shouldAutoSync(state: AutoSyncState, url: string | undefined, now: number): boolean {
  if (!state.enabled || !state.canvasOrigin || !url) return false
  let origin: string
  try {
    origin = new URL(url).origin
  } catch {
    return false
  }
  if (origin !== state.canvasOrigin) return false
  if (state.lastSuccessAt !== null && now - state.lastSuccessAt < AUTO_SYNC_GAP_MS) return false
  if (state.lastAttemptAt !== null && now - state.lastAttemptAt < AUTO_SYNC_RETRY_MS) return false
  return true
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

