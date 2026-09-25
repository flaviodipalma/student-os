import { LMS_NAMES, timeAgo, type AutoSyncState } from "./auto-sync"
import {
  importChosen,
  loadAddress,
  loadAutoSync,
  loadChoice,
  NOT_AN_LMS,
  readCourses,
  saveAddress,
  saveChoice,
  setLoggedOut,
  updateSite,
} from "./lms-sync"
import { courseOptions, groupByTerm, initialSelection, type CourseOption } from "./courses"
import { currentAccount, DEFAULT_ADDRESS, normalizeAddress, StudentOsError } from "./student-os"

// The popup. It syncs to the Student OS account logged in in this browser (Chrome
// sends that login with the extension's requests), so there's nothing to set up:
// it checks who's logged in, then syncs Canvas or Blackboard from the tab the
// student is on. Sync reads the course list, lets the student choose (the first
// time, and when a new semester shows up), then imports those courses. After a
// site's first sync, a switch turns on automatic sync (background.ts) for it.

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const checking = $<HTMLDivElement>("checking")
const loggedOut = $<HTMLElement>("logged-out")
const signedIn = $<HTMLElement>("signed-in")
const connectionError = $<HTMLDivElement>("connection-error")
const addressForm = $<HTMLFormElement>("address-form")
const addressInput = $<HTMLInputElement>("address")
const syncButton = $<HTMLButtonElement>("sync")
const progress = $<HTMLParagraphElement>("progress")
const picker = $<HTMLFormElement>("picker")
const pickerGroups = $<HTMLDivElement>("picker-groups")
const importButton = $<HTMLButtonElement>("import-chosen")
const result = $<HTMLDivElement>("result")
const syncError = $<HTMLDivElement>("sync-error")
const autoCard = $<HTMLDivElement>("auto-sync")
const newCourses = $<HTMLDivElement>("new-courses")

let address = DEFAULT_ADDRESS

function setText(element: HTMLElement, message: string | null) {
  element.textContent = message ?? ""
  element.hidden = !message
}

// A notice (icon + text): the text goes in its "-text" element, so the icon stays.
function setNotice(notice: HTMLElement, message: string | null) {
  $(`${notice.id}-text`).textContent = message ?? ""
  notice.hidden = !message
}

// ---- Who's logged in -------------------------------------------------------------

type State = { kind: "checking" } | { kind: "signed-in"; firstName: string } | { kind: "logged-out"; message?: string } | { kind: "error"; message: string }

function show(state: State) {
  checking.hidden = state.kind !== "checking"
  signedIn.hidden = state.kind !== "signed-in"
  loggedOut.hidden = state.kind !== "logged-out"
  setNotice(connectionError, state.kind === "error" ? state.message : null)
  if (state.kind === "signed-in") {
    $("first-name").textContent = state.firstName
    $("avatar").textContent = state.firstName.trim().charAt(0).toUpperCase() || "?"
  }
  if (state.kind === "logged-out") {
    $("logged-out-message").textContent = state.message ?? "Log in in this browser. The extension syncs to that account."
  }
  $("address-label").textContent = address.replace(/^https?:\/\//, "")
}

async function checkLogin() {
  show({ kind: "checking" })
  try {
    const account = await currentAccount(address, fetch)
    show({ kind: "signed-in", firstName: account.firstName })
    // Logged in again: automatic sync can carry on.
    showAutoSync(await setLoggedOut(false))
  } catch (error) {
    if (error instanceof StudentOsError && error.loggedOut) show({ kind: "logged-out" })
    else show({ kind: "error", message: error instanceof StudentOsError ? error.message : "Something went wrong. Please try again." })
  }
}

// ---- Automatic sync ------------------------------------------------------------

// One switch per site the student has synced by hand (so its courses are known).
function showAutoSync(state: AutoSyncState) {
  const sites = Object.entries(state.sites)
  autoCard.hidden = sites.length === 0
  $("auto-sites").replaceChildren(
    ...sites.map(([origin, site]) => {
      const row = document.createElement("label")
      row.className = "switch-row"
      row.dataset.site = origin
      const text = document.createElement("span")
      text.className = "switch-text"
      const title = document.createElement("span")
      title.className = "switch-title"
      title.textContent = `${LMS_NAMES[site.lms]} · ${origin.replace(/^https?:\/\//, "")}`
      const status = document.createElement("span")
      status.className = "caption"
      const last = site.lastSuccessAt ? `${site.lastAutomatic ? "Synced automatically" : "Last synced"} · ${timeAgo(site.lastSuccessAt, Date.now())}` : null
      status.textContent = site.enabled ? (last ?? "On · when you open it, every 30 minutes at most") : "Off · turn on to sync whenever you open it"
      text.append(title, status)
      const toggle = document.createElement("input")
      toggle.type = "checkbox"
      toggle.setAttribute("role", "switch")
      toggle.className = "switch"
      toggle.checked = site.enabled
      toggle.setAttribute("aria-label", `Sync ${LMS_NAMES[site.lms]} automatically`)
      toggle.addEventListener("change", () => void setAutoSync(origin, site.lms, toggle.checked))
      row.append(text, toggle)
      return row
    })
  )
  const withNew = sites.filter(([, site]) => site.newCourses).map(([, site]) => LMS_NAMES[site.lms])
  newCourses.hidden = withNew.length === 0
  $("new-courses-title").textContent = `New courses in ${[...new Set(withNew)].join(" and ")}`
}

async function setAutoSync(origin: string, lms: keyof typeof LMS_NAMES, on: boolean) {
  const origins = [`${origin}/*`]
  if (on) {
    // Access to the student's site, so the extension can read it without a click.
    const granted = await chrome.permissions.request({ origins }).catch(() => false)
    showAutoSync(await updateSite(origin, lms, { enabled: granted }))
    if (!granted) setNotice(syncError, `Automatic sync needs access to your ${LMS_NAMES[lms]}. Turn it on again and choose Allow.`)
  } else {
    showAutoSync(await updateSite(origin, lms, { enabled: false }))
    // Give the access back (not possible for addresses the extension always has, like this computer).
    await chrome.permissions.remove({ origins }).catch(() => false)
  }
}

// ---- The Student OS address --------------------------------------------------------

// Student OS is reached with a host permission for its address (that's also what lets
// Chrome send the login). This computer is granted in the manifest; any other address
// is asked for once.
async function allowAddress(origin: string): Promise<boolean> {
  const origins = [`${origin}/*`]
  return (await chrome.permissions.contains({ origins })) || chrome.permissions.request({ origins })
}

$("change-address").addEventListener("click", (event) => {
  event.preventDefault()
  addressInput.value = address
  addressForm.hidden = !addressForm.hidden
  if (!addressForm.hidden) addressInput.focus()
})
$("cancel-address").addEventListener("click", () => {
  addressForm.hidden = true
})
addressForm.addEventListener("submit", async (event) => {
  event.preventDefault()
  try {
    const next = normalizeAddress(addressInput.value)
    if (!(await allowAddress(next))) throw new StudentOsError(`The extension needs permission to reach ${next}.`)
    address = next
    await saveAddress(address)
    addressForm.hidden = true
    await checkLogin()
  } catch (error) {
    show({ kind: "error", message: error instanceof StudentOsError ? error.message : "Something went wrong. Please try again." })
  }
})

$("log-in").addEventListener("click", () => {
  void chrome.tabs.create({ url: `${address}/login` })
})
$("check-again").addEventListener("click", () => void checkLogin())

// ---- Choosing courses ----------------------------------------------------------

// The tab to read: the one the student clicked the extension on. (Opened as a page,
// e.g. in tests, ?tab=<id> names it instead.)
async function canvasTab(): Promise<chrome.tabs.Tab | undefined> {
  const named = Number(new URLSearchParams(location.search).get("tab"))
  if (named) return chrome.tabs.get(named)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

// Shows the checklist; resolves with the chosen ids, or null if the student cancels.
function chooseCourses(options: CourseOption[], selected: Set<string>): Promise<string[] | null> {
  const chosen = new Set(selected)
  const updateButton = () => {
    importButton.disabled = chosen.size === 0
    importButton.textContent = chosen.size === 0 ? "Choose at least one course" : `Import ${chosen.size} ${chosen.size === 1 ? "course" : "courses"}`
  }
  pickerGroups.replaceChildren(
    ...groupByTerm(options, Date.now()).map((group) => {
      const fieldset = document.createElement("fieldset")
      const legend = document.createElement("legend")
      legend.textContent = group.name
      if (group.current) {
        const badge = document.createElement("span")
        badge.className = "badge"
        badge.textContent = "Current"
        legend.append(badge)
      }
      fieldset.append(legend)
      for (const course of group.courses) {
        const label = document.createElement("label")
        label.className = "course"
        const box = document.createElement("input")
        box.type = "checkbox"
        box.value = course.id
        box.checked = chosen.has(course.id)
        box.addEventListener("change", () => {
          if (box.checked) chosen.add(course.id)
          else chosen.delete(course.id)
          updateButton()
        })
        const name = document.createElement("span")
        name.textContent = course.label
        label.append(box, name)
        fieldset.append(label)
      }
      return fieldset
    })
  )
  updateButton()
  picker.hidden = false
  syncButton.hidden = true

  return new Promise((resolve) => {
    const finish = (value: string[] | null) => {
      picker.hidden = true
      syncButton.hidden = false
      picker.onsubmit = null
      $("cancel-pick").onclick = null
      resolve(value)
    }
    picker.onsubmit = (event) => {
      event.preventDefault()
      if (chosen.size > 0) finish(options.map((o) => o.id).filter((id) => chosen.has(id)))
    }
    $("cancel-pick").onclick = () => finish(null)
  })
}

// ---- Sync ----------------------------------------------------------------------

async function sync(choose: boolean): Promise<{ lines: string[]; name: string } | null> {
  const tab = await canvasTab()
  if (!tab?.id) throw new StudentOsError(NOT_AN_LMS)

  setText(progress, "Reading your courses…")
  const { lms, list } = await readCourses(tab.id, tab.url)
  const options = courseOptions(list.choices)
  if (options.length === 0) throw new StudentOsError(`${lms.name} doesn't list any active courses for you.`)

  const saved = await loadChoice(list.baseUrl)
  const { selected, needsReview } = initialSelection(options, saved, Date.now())
  let chosen = options.map((o) => o.id).filter((id) => selected.has(id))
  if (choose || needsReview || chosen.length === 0) {
    setText(progress, null)
    const picked = await chooseCourses(options, selected)
    if (!picked) return null
    chosen = picked
    await saveChoice(list.baseUrl, { selected: chosen, seen: options.map((o) => o.id) })
    // Every course has been seen now.
    await updateSite(list.baseUrl, lms.id, { newCourses: false })
  }

  const lines = await importChosen(tab.id, address, lms, list, chosen, { automatic: false, onProgress: (message) => setText(progress, message) })
  showAutoSync(await loadAutoSync())
  return { lines, name: lms.name }
}

async function runSync(choose: boolean) {
  setNotice(syncError, null)
  result.hidden = true
  syncButton.disabled = true
  syncButton.setAttribute("aria-busy", "true")
  $("sync-label").textContent = "Syncing…"
  try {
    const synced = await sync(choose)
    if (!synced) return
    $("result-title").textContent = `${synced.name} sync complete.`
    $("result-lines").replaceChildren(
      ...synced.lines.map((line) => {
        const item = document.createElement("li")
        item.textContent = line
        return item
      })
    )
    result.hidden = false
  } catch (error) {
    if (error instanceof StudentOsError && error.loggedOut) {
      // Logged out of Student OS since the popup opened.
      show({ kind: "logged-out", message: "You're logged out of Student OS. Log in, then click Sync now again." })
      return
    }
    setNotice(syncError, error instanceof StudentOsError ? error.message : "Something went wrong. Please try again.")
  } finally {
    setText(progress, null)
    syncButton.disabled = false
    syncButton.removeAttribute("aria-busy")
    $("sync-label").textContent = "Sync now"
  }
}

syncButton.addEventListener("click", () => void runSync(false))
for (const id of ["choose-courses", "review-courses"]) {
  $(id).addEventListener("click", (event) => {
    event.preventDefault()
    if (!syncButton.disabled) void runSync(true)
  })
}
$("open-student-os").addEventListener("click", (event) => {
  event.preventDefault()
  void chrome.tabs.create({ url: `${address}/tasks` })
})

void loadAddress().then((stored) => {
  address = stored
  void checkLogin()
})
