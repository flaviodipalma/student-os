import { autoSyncCourses, shouldAutoSync, siteFor } from "./auto-sync"
import { courseOptions } from "./courses"
import { importChosen, LMS, loadAddress, loadAutoSync, loadChoice, setLoggedOut, showBadge, updateSite } from "./lms-sync"
import { currentAccount, StudentOsError } from "./student-os"

// The background worker: syncs automatically when the student opens their Canvas or
// Blackboard (a switch per site in the popup, which also grants access to that
// site). At most once every half hour per site, only the courses they chose,
// quietly: a badge on the extension icon only when something needs them (logged out
// of Student OS, new courses). Anything else (logged out of the LMS, offline) is
// skipped until the next visit.

const running = new Set<string>()

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  // The tab's address is only visible for sites the extension has access to, i.e.
  // the student's sites with automatic sync on.
  if (info.status === "complete") void autoSync(tabId, tab.url)
})

async function autoSync(tabId: number, url: string | undefined) {
  const found = siteFor(await loadAutoSync(), url)
  if (!found || running.has(found.origin) || !shouldAutoSync(found.site, Date.now())) return
  const { origin, site } = found
  const lms = LMS[site.lms]
  running.add(origin)
  try {
    await updateSite(origin, lms.id, { lastAttemptAt: Date.now() })
    const address = await loadAddress()

    // Logged in to Student OS? (Checked first: it's quick, and nothing is read from the LMS otherwise.)
    try {
      await currentAccount(address, fetch)
      await setLoggedOut(false)
    } catch (error) {
      if (error instanceof StudentOsError && error.loggedOut) await setLoggedOut(true)
      return
    }

    const read = await lms.courses(tabId)
    if (!read.ok || read.value.baseUrl !== origin) return
    const list = read.value
    const plan = autoSyncCourses(courseOptions(list.choices), await loadChoice(origin))
    if (!plan) return
    if (plan.ids.length > 0) await importChosen(tabId, address, lms, list, plan.ids, { automatic: true })
    await updateSite(origin, lms.id, { newCourses: plan.newCourses })
  } catch {
    // Logged out of the LMS, offline, Student OS unreachable: try again on a later visit.
  } finally {
    running.delete(origin)
  }
}

// Access to a site removed in Chrome's settings: automatic sync is off there.
chrome.permissions.onRemoved.addListener(async (removed) => {
  const state = await loadAutoSync()
  for (const [origin, site] of Object.entries(state.sites)) {
    if (site.enabled && removed.origins?.some((pattern) => pattern.startsWith(origin))) await updateSite(origin, site.lms, { enabled: false })
  }
})

// The badge after Chrome restarts (it isn't kept).
chrome.runtime.onStartup.addListener(async () => {
  await showBadge(await loadAutoSync())
  await markStudentOs()
})

// ---- Telling Student OS the extension is installed ------------------------------------

// marker.ts runs on the Student OS address the student uses, so its pages (onboarding)
// know the extension is there. Registered for that address (the extension has access
// to it), again whenever it changes, and added right away to Student OS tabs already
// open (the onboarding page is usually open while the extension is being installed).
async function markStudentOs() {
  const address = await loadAddress()
  const matches = [`${address}/*`]
  try {
    await chrome.scripting.unregisterContentScripts({ ids: ["student-os-marker"] }).catch(() => {})
    await chrome.scripting.registerContentScripts([{ id: "student-os-marker", matches, js: ["marker.js"], runAt: "document_start" }])
    const tabs = await chrome.tabs.query({ url: matches })
    await Promise.all(
      tabs.map((tab) => (tab.id ? chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["marker.js"] }).catch(() => {}) : null))
    )
  } catch {
    // No access to that address yet (it's asked for when the student saves it).
  }
}

chrome.runtime.onInstalled.addListener(() => void markStudentOs())
chrome.storage.onChanged.addListener((changes) => {
  if (changes.address) void markStudentOs()
})
