// The Chrome side of syncing, shared by the popup (Sync now) and the background
// worker (automatic sync): what's stored, reading Canvas inside a tab, sending the
// import, and the badge on the extension icon.
import { INITIAL_AUTO_SYNC, type AutoSyncState } from "./auto-sync"
import { readCanvas, type CanvasRead, type CanvasStep } from "./canvas"
import type { CourseChoice } from "./courses"
import { DEFAULT_ADDRESS, sendImport, StudentOsError, summaryLines } from "./student-os"

const ADDRESS_KEY = "address"
const AUTO_SYNC_KEY = "autoSync"
const choiceKey = (canvasOrigin: string) => `courses:${canvasOrigin}`

// ---- Stored (chrome.storage.local, this computer only) -------------------------

export async function loadAddress(): Promise<string> {
  const stored = await chrome.storage.local.get(ADDRESS_KEY)
  return typeof stored[ADDRESS_KEY] === "string" ? stored[ADDRESS_KEY] : DEFAULT_ADDRESS
}

export async function saveAddress(address: string): Promise<void> {
  await chrome.storage.local.set({ [ADDRESS_KEY]: address })
}

export async function loadChoice(canvasOrigin: string): Promise<CourseChoice | null> {
  const stored = await chrome.storage.local.get(choiceKey(canvasOrigin))
  return (stored[choiceKey(canvasOrigin)] as CourseChoice | undefined) ?? null
}

export async function saveChoice(canvasOrigin: string, choice: CourseChoice): Promise<void> {
  await chrome.storage.local.set({ [choiceKey(canvasOrigin)]: choice })
}

export async function loadAutoSync(): Promise<AutoSyncState> {
  const stored = await chrome.storage.local.get(AUTO_SYNC_KEY)
  return { ...INITIAL_AUTO_SYNC, ...(stored[AUTO_SYNC_KEY] as Partial<AutoSyncState> | undefined) }
}

export async function updateAutoSync(changes: Partial<AutoSyncState>): Promise<AutoSyncState> {
  const next = { ...(await loadAutoSync()), ...changes }
  await chrome.storage.local.set({ [AUTO_SYNC_KEY]: next })
  await showBadge(next)
  return next
}

// ---- The badge: only when something needs the student ----------------------------

export async function showBadge(state: AutoSyncState): Promise<void> {
  const badge =
    state.problem === "logged-out"
      ? { text: "!", color: "#dc2626", title: "Student OS: log in to keep syncing Canvas" }
      : state.problem === "new-courses"
        ? { text: "New", color: "#4f46e5", title: "Student OS: new courses in Canvas. Choose which to sync." }
        : { text: "", color: "#4f46e5", title: "Student OS" }
  await chrome.action.setBadgeText({ text: badge.text })
  await chrome.action.setBadgeBackgroundColor({ color: badge.color })
  await chrome.action.setTitle({ title: badge.title })
}

// ---- Reading Canvas in a tab ----------------------------------------------------

export const READ_PROBLEMS = {
  "not-canvas": "This tab isn't Canvas. Open your school's Canvas, then click Sync now.",
  "logged-out": "You're logged out of Canvas. Log in, then click Sync now.",
  error: "Canvas didn't answer. Reload the Canvas page and try again.",
}

// Runs readCanvas inside the Canvas tab (it's copied there), with the student's Canvas
// login. Throws a StudentOsError with a message for the student.
export async function inCanvas<K extends CanvasStep["kind"]>(tabId: number, step: CanvasStep & { kind: K }) {
  let read: CanvasRead | undefined
  try {
    const [injection] = await chrome.scripting.executeScript({ target: { tabId }, func: readCanvas, args: [step] })
    read = injection?.result as CanvasRead | undefined
  } catch {
    // Pages the extension can't run on (the Chrome Web Store, chrome:// pages, …).
    throw new StudentOsError(READ_PROBLEMS["not-canvas"])
  }
  if (!read) throw new StudentOsError(READ_PROBLEMS.error)
  if (!read.ok) throw new StudentOsError(READ_PROBLEMS[read.reason])
  return read as Extract<CanvasRead, { ok: true; kind: K }>
}

// Reads the chosen courses' assignments and imports them. Records the sync (which
// also restarts the half hour before the next automatic one). Returns the summary lines.
export async function importChosen(
  tabId: number,
  address: string,
  list: { baseUrl: string; courses: Record<string, unknown>[] },
  chosen: string[],
  options: { automatic: boolean; onProgress?: (message: string) => void }
): Promise<string[]> {
  options.onProgress?.(`Reading assignments from ${chosen.length} ${chosen.length === 1 ? "course" : "courses"}…`)
  const read = await inCanvas(tabId, { kind: "assignments", courseIds: chosen })
  const courses = list.courses.filter((course) => chosen.includes(String(course.id)))

  options.onProgress?.("Sending to Student OS…")
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const summary = await sendImport(address, { baseUrl: list.baseUrl, courses, assignments: read.assignments }, timeZone, fetch)
  await updateAutoSync({ canvasOrigin: list.baseUrl, lastSuccessAt: Date.now(), lastAutomatic: options.automatic })
  return summaryLines(summary, read.coursesUnreadable)
}
