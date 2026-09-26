// The Chrome side of syncing, shared by the popup (Sync now) and the background
// worker (automatic sync): what's stored, reading Canvas or Blackboard inside a tab
// (and telling which one it is), sending the import, and the badge on the icon.
import { badgeFor, migrateAutoSync, newSite, type AutoSyncState, type LmsId, type SiteSync } from "./auto-sync"
import { readBlackboard, type BlackboardRead, type BlackboardStep } from "./blackboard"
import { readCanvas, type CanvasRead, type CanvasStep } from "./canvas"
import type { CourseChoice } from "./courses"
import { DEFAULT_ADDRESS, sendImport, StudentOsError, summaryLines } from "./student-os"

const ADDRESS_KEY = "address"
const AUTO_SYNC_KEY = "autoSync"
const choiceKey = (siteOrigin: string) => `courses:${siteOrigin}`

// ---- Stored (chrome.storage.local, this computer only) -------------------------

export async function loadAddress(): Promise<string> {
  const stored = await chrome.storage.local.get(ADDRESS_KEY)
  return typeof stored[ADDRESS_KEY] === "string" ? stored[ADDRESS_KEY] : DEFAULT_ADDRESS
}

export async function saveAddress(address: string): Promise<void> {
  await chrome.storage.local.set({ [ADDRESS_KEY]: address })
}

export async function loadChoice(siteOrigin: string): Promise<CourseChoice | null> {
  const stored = await chrome.storage.local.get(choiceKey(siteOrigin))
  return (stored[choiceKey(siteOrigin)] as CourseChoice | undefined) ?? null
}

export async function saveChoice(siteOrigin: string, choice: CourseChoice): Promise<void> {
  await chrome.storage.local.set({ [choiceKey(siteOrigin)]: choice })
}

export async function loadAutoSync(): Promise<AutoSyncState> {
  const stored = await chrome.storage.local.get(AUTO_SYNC_KEY)
  return migrateAutoSync(stored[AUTO_SYNC_KEY])
}

async function saveAutoSync(state: AutoSyncState): Promise<AutoSyncState> {
  await chrome.storage.local.set({ [AUTO_SYNC_KEY]: state })
  await showBadge(state)
  return state
}

// Changes one site's automatic-sync record (created on the first sync by hand).
export async function updateSite(origin: string, lms: LmsId, changes: Partial<SiteSync>): Promise<AutoSyncState> {
  const state = await loadAutoSync()
  const site = Object.hasOwn(state.sites, origin) ? state.sites[origin] : newSite(lms)
  return saveAutoSync({ ...state, sites: { ...state.sites, [origin]: { ...site, ...changes } } })
}

export async function setLoggedOut(loggedOut: boolean): Promise<AutoSyncState> {
  const state = await loadAutoSync()
  return state.loggedOut === loggedOut ? state : saveAutoSync({ ...state, loggedOut })
}

// ---- The badge: only when something needs the student ----------------------------

export async function showBadge(state: AutoSyncState): Promise<void> {
  const text = badgeFor(state)
  const title =
    text === "!" ? "Student OS: log in to keep syncing" : text === "New" ? "Student OS: new courses to choose from" : "Student OS"
  await chrome.action.setBadgeText({ text })
  await chrome.action.setBadgeBackgroundColor({ color: text === "!" ? "#dc2626" : "#4f46e5" })
  await chrome.action.setTitle({ title })
}

// ---- Reading Canvas or Blackboard in a tab ------------------------------------------

export const NOT_AN_LMS = "This tab isn't Canvas or Blackboard. Open your school's Canvas or Blackboard, then click Sync now."
const loggedOutOf = (name: string) => `You're logged out of ${name}. Log in, then click Sync now.`
const noAnswer = (name: string) => `${name} didn't answer. Reload the page and try again.`

type CoursesRead = { baseUrl: string; courses: Record<string, unknown>[]; choices: Record<string, unknown>[] }
type AssignmentsRead = { data: Record<string, unknown>; coursesUnreadable: number }
type Attempt<T> = { ok: true; value: T } | { ok: false; reason: "wrong-site" | "logged-out" | "error" }

// What differs between Canvas and Blackboard. Everything else (choosing courses,
// automatic sync, the import) is shared.
export type Lms = {
  id: LmsId
  name: string
  courses(tabId: number): Promise<Attempt<CoursesRead>>
  assignments(tabId: number, courseIds: string[]): Promise<Attempt<AssignmentsRead>>
  // The id of a course as sent (matches the choices' ids).
  courseId(course: Record<string, unknown>): string
}

// Runs a reader inside the tab's main page (it's copied there), with the student's
// login for that site. Null when the extension can't run there (chrome:// pages, …).
async function inTab<Step, Read>(tabId: number, func: (step: Step) => Promise<Read>, step: Step): Promise<Read | null> {
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: func as (step: unknown) => Promise<unknown>, args: [step] })
    return (injection?.result as Read | undefined) ?? null
  } catch {
    return null
  }
}

function attempt<R extends { ok: true } | { ok: false; reason: string }, T>(
  read: R | null,
  wrongSite: string,
  value: (read: Extract<R, { ok: true }>) => T
): Attempt<T> {
  if (!read) return { ok: false, reason: "wrong-site" }
  if (!read.ok) {
    const reason = read.reason
    return { ok: false, reason: reason === wrongSite ? "wrong-site" : reason === "logged-out" ? "logged-out" : "error" }
  }
  return { ok: true, value: value(read as Extract<R, { ok: true }>) }
}

export const LMS: Record<LmsId, Lms> = {
  canvas: {
    id: "canvas",
    name: "Canvas",
    courses: async (tabId) =>
      attempt(await inTab<CanvasStep, CanvasRead>(tabId, readCanvas, { kind: "courses" }), "not-canvas", (read) => {
        const { courses } = read as Extract<CanvasRead, { kind: "courses" }>
        return { baseUrl: read.baseUrl, courses, choices: courses }
      }),
    assignments: async (tabId, courseIds) =>
      attempt(await inTab<CanvasStep, CanvasRead>(tabId, readCanvas, { kind: "assignments", courseIds }), "not-canvas", (read) => {
        const { assignments, coursesUnreadable } = read as Extract<CanvasRead, { kind: "assignments" }>
        return { data: { assignments }, coursesUnreadable }
      }),
    courseId: (course) => String(course.id),
  },
  blackboard: {
    id: "blackboard",
    name: "Blackboard",
    courses: async (tabId) =>
      attempt(await inTab<BlackboardStep, BlackboardRead>(tabId, readBlackboard, { kind: "courses" }), "not-blackboard", (read) => {
        const { courses, choices } = read as Extract<BlackboardRead, { kind: "courses" }>
        return { baseUrl: read.baseUrl, courses, choices }
      }),
    assignments: async (tabId, courseIds) =>
      attempt(await inTab<BlackboardStep, BlackboardRead>(tabId, readBlackboard, { kind: "assignments", courseIds }), "not-blackboard", (read) => {
        const { instructors, columns, grades, attempts, coursesUnreadable } = read as Extract<BlackboardRead, { kind: "assignments" }>
        return { data: { instructors, columns, grades, attempts }, coursesUnreadable }
      }),
    courseId: (course) => String((course.course as { id?: unknown } | undefined)?.id ?? course.courseId),
  },
}

// Which system the tab is, with its course list. A site synced before is known;
// otherwise the address hints which to try first, then the other.
export async function readCourses(tabId: number, url: string | undefined): Promise<{ lms: Lms; list: CoursesRead }> {
  let origin: string
  try {
    origin = new URL(url ?? "").origin
  } catch {
    throw new StudentOsError(NOT_AN_LMS)
  }
  if (!/^https?:/.test(origin)) throw new StudentOsError(NOT_AN_LMS)
  const state = await loadAutoSync()
  const known = Object.hasOwn(state.sites, origin) ? state.sites[origin].lms : null
  const order: LmsId[] = known ? [known, known === "canvas" ? "blackboard" : "canvas"] : /blackboard/i.test(origin) ? ["blackboard", "canvas"] : ["canvas", "blackboard"]
  for (const id of order) {
    const lms = LMS[id]
    const read = await lms.courses(tabId)
    if (read.ok) return { lms, list: read.value }
    if (read.reason === "logged-out") throw new StudentOsError(loggedOutOf(lms.name))
    if (read.reason === "error") throw new StudentOsError(noAnswer(lms.name))
  }
  throw new StudentOsError(NOT_AN_LMS)
}

// Reads the chosen courses' assignments and imports them. Records the sync (which
// also restarts the half hour before the next automatic one). Returns the summary lines.
export async function importChosen(
  tabId: number,
  address: string,
  lms: Lms,
  list: CoursesRead,
  chosen: string[],
  options: { automatic: boolean; onProgress?: (message: string) => void }
): Promise<string[]> {
  options.onProgress?.(`Reading assignments from ${chosen.length} ${chosen.length === 1 ? "course" : "courses"}…`)
  const read = await lms.assignments(tabId, chosen)
  if (!read.ok) throw new StudentOsError(read.reason === "logged-out" ? loggedOutOf(lms.name) : noAnswer(lms.name))
  const courses = list.courses.filter((course) => chosen.includes(lms.courseId(course)))

  options.onProgress?.("Sending to Student OS…")
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const summary = await sendImport(address, lms.id, { baseUrl: list.baseUrl, courses, ...read.value.data }, timeZone, fetch)
  await updateSite(list.baseUrl, lms.id, { lastSuccessAt: Date.now(), lastAutomatic: options.automatic })
  await tellStudentOsTabs(address)
  return summaryLines(summary, read.value.coursesUnreadable, lms.name)
}

// Open Student OS tabs show the import right away: a "student-os-synced" event on
// their page (it reloads the courses). Only an event, with no data; tabs the
// extension can't reach simply catch up when the student returns to them.
async function tellStudentOsTabs(address: string) {
  try {
    const tabs = await chrome.tabs.query({ url: `${address}/*` })
    await Promise.all(
      tabs.map((tab) =>
        tab.id
          ? chrome.scripting
              .executeScript({ target: { tabId: tab.id }, func: () => void document.dispatchEvent(new CustomEvent("student-os-synced")) })
              .catch(() => {})
          : null
      )
    )
  } catch {
    // No access to the Student OS address: the page refreshes when it's next focused.
  }
}

