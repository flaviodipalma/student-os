import { autoSyncCourses, shouldAutoSync } from "./auto-sync"
import { importChosen, inCanvas, loadAddress, loadAutoSync, loadChoice, showBadge, updateAutoSync } from "./canvas-sync"
import { courseOptions } from "./courses"
import { currentAccount, StudentOsError } from "./student-os"

// The background worker: syncs Canvas automatically when the student opens it
// (switch on in the popup, which also grants access to their Canvas address). At
// most once every half hour, only the courses they chose, quietly: a badge on the
// extension icon only when something needs them (logged out of Student OS, new
// courses in Canvas). Anything else (logged out of Canvas, offline) is skipped
// until the next visit.

let running = false

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // The tab's address is only visible for sites the extension has access to, i.e.
  // the student's Canvas once the switch is on.
  if (info.status === "complete") void autoSync(tabId, tab.url)
})

async function autoSync(tabId: number, url: string | undefined) {
  if (running) return
  const state = await loadAutoSync()
  if (!shouldAutoSync(state, url, Date.now())) return
  running = true
  try {
    await updateAutoSync({ lastAttemptAt: Date.now() })
    const address = await loadAddress()

    // Logged in to Student OS? (Checked first: it's quick, and nothing is read from Canvas otherwise.)
    try {
      await currentAccount(address, fetch)
    } catch (error) {
      if (error instanceof StudentOsError && error.loggedOut) await updateAutoSync({ problem: "logged-out" })
      return
    }

    const list = await inCanvas(tabId, { kind: "courses" })
    const plan = autoSyncCourses(courseOptions(list.courses), await loadChoice(list.baseUrl))
    if (!plan) return
    const problem = plan.newCourses ? "new-courses" : null
    if (plan.ids.length > 0) await importChosen(tabId, address, list, plan.ids, { automatic: true })
    await updateAutoSync({ problem })
  } catch {
    // Logged out of Canvas, offline, Student OS unreachable: try again on a later visit.
  } finally {
    running = false
  }
}

// Access to Canvas removed in Chrome's settings: automatic sync is off.
chrome.permissions.onRemoved.addListener(async (removed) => {
  const state = await loadAutoSync()
  if (state.canvasOrigin && removed.origins?.some((origin) => origin.startsWith(state.canvasOrigin!))) {
    await updateAutoSync({ enabled: false })
  }
})

// The badge after Chrome restarts (it isn't kept).
chrome.runtime.onStartup.addListener(async () => showBadge(await loadAutoSync()))
