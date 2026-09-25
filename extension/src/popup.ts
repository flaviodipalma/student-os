import { readCanvas, type CanvasRead, type CanvasStep } from "./canvas"
import { courseOptions, groupByTerm, initialSelection, type CourseChoice, type CourseOption } from "./courses"
import { currentAccount, DEFAULT_ADDRESS, normalizeAddress, sendImport, StudentOsError, summaryLines } from "./student-os"

// The popup. It syncs to the Student OS account logged in in this browser (Chrome
// sends that login with the extension's requests), so there's nothing to set up:
// it checks who's logged in, then syncs Canvas from the tab the student is on.
// Sync reads the course list, lets the student choose (the first time, and when a
// new semester shows up), then imports those courses. The Student OS address and the
// course choices are kept in chrome.storage.local, on this computer only.

const ADDRESS_KEY = "address"
const choiceKey = (canvasOrigin: string) => `courses:${canvasOrigin}`

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const checking = $<HTMLParagraphElement>("checking")
const loggedOut = $<HTMLElement>("logged-out")
const signedIn = $<HTMLElement>("signed-in")
const connectionError = $<HTMLParagraphElement>("connection-error")
const addressForm = $<HTMLFormElement>("address-form")
const addressInput = $<HTMLInputElement>("address")
const syncButton = $<HTMLButtonElement>("sync")
const progress = $<HTMLParagraphElement>("progress")
const picker = $<HTMLFormElement>("picker")
const pickerGroups = $<HTMLDivElement>("picker-groups")
const importButton = $<HTMLButtonElement>("import-chosen")
const result = $<HTMLDivElement>("result")
const syncError = $<HTMLParagraphElement>("sync-error")

let address = DEFAULT_ADDRESS

function setText(element: HTMLElement, message: string | null) {
  element.textContent = message ?? ""
  element.hidden = !message
}

// ---- Who's logged in -------------------------------------------------------------

type State = { kind: "checking" } | { kind: "signed-in"; firstName: string } | { kind: "logged-out"; message?: string } | { kind: "error"; message: string }

function show(state: State) {
  checking.hidden = state.kind !== "checking"
  signedIn.hidden = state.kind !== "signed-in"
  loggedOut.hidden = state.kind !== "logged-out"
  setText(connectionError, state.kind === "error" ? state.message : null)
  if (state.kind === "signed-in") $("first-name").textContent = state.firstName
  if (state.kind === "logged-out") {
    $("logged-out-message").textContent = state.message ?? "Log in to Student OS in this browser. The extension syncs to that account."
  }
  $("address-label").textContent = address.replace(/^https?:\/\//, "")
}

async function checkLogin() {
  show({ kind: "checking" })
  try {
    const account = await currentAccount(address, fetch)
    show({ kind: "signed-in", firstName: account.firstName })
  } catch (error) {
    if (error instanceof StudentOsError && error.loggedOut) show({ kind: "logged-out" })
    else show({ kind: "error", message: error instanceof StudentOsError ? error.message : "Something went wrong. Please try again." })
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
    await chrome.storage.local.set({ [ADDRESS_KEY]: address })
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

// ---- Reading Canvas ------------------------------------------------------------

// The tab to read: the one the student clicked the extension on. (Opened as a page,
// e.g. in tests, ?tab=<id> names it instead.)
async function canvasTab(): Promise<chrome.tabs.Tab | undefined> {
  const named = Number(new URLSearchParams(location.search).get("tab"))
  if (named) return chrome.tabs.get(named)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

const READ_PROBLEMS = {
  "not-canvas": "This tab isn't Canvas. Open your school's Canvas, then click Sync now.",
  "logged-out": "You're logged out of Canvas. Log in, then click Sync now.",
  error: "Canvas didn't answer. Reload the Canvas page and try again.",
}

// Runs readCanvas inside the Canvas tab (it's copied there), with the student's Canvas login.
async function inCanvas<K extends CanvasStep["kind"]>(tabId: number, step: CanvasStep & { kind: K }) {
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

// ---- Choosing courses ----------------------------------------------------------

async function loadChoice(canvasOrigin: string): Promise<CourseChoice | null> {
  const stored = await chrome.storage.local.get(choiceKey(canvasOrigin))
  return (stored[choiceKey(canvasOrigin)] as CourseChoice | undefined) ?? null
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

async function sync(choose: boolean): Promise<string[] | null> {
  const tab = await canvasTab()
  if (!tab?.id || !/^https?:/.test(tab.url ?? "")) throw new StudentOsError(READ_PROBLEMS["not-canvas"])

  setText(progress, "Reading your Canvas courses…")
  const list = await inCanvas(tab.id, { kind: "courses" })
  const options = courseOptions(list.courses)
  if (options.length === 0) throw new StudentOsError("Canvas doesn't list any active courses for you.")

  const saved = await loadChoice(list.baseUrl)
  const { selected, needsReview } = initialSelection(options, saved, Date.now())
  let chosen = options.map((o) => o.id).filter((id) => selected.has(id))
  if (choose || needsReview || chosen.length === 0) {
    setText(progress, null)
    const picked = await chooseCourses(options, selected)
    if (!picked) return null
    chosen = picked
    await chrome.storage.local.set({ [choiceKey(list.baseUrl)]: { selected: chosen, seen: options.map((o) => o.id) } satisfies CourseChoice })
  }

  setText(progress, `Reading assignments from ${chosen.length} ${chosen.length === 1 ? "course" : "courses"}…`)
  const read = await inCanvas(tab.id, { kind: "assignments", courseIds: chosen })
  const courses = list.courses.filter((course) => chosen.includes(String(course.id)))

  setText(progress, "Sending to Student OS…")
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const summary = await sendImport(address, { baseUrl: list.baseUrl, courses, assignments: read.assignments }, timeZone, fetch)
  return summaryLines(summary, read.coursesUnreadable)
}

async function runSync(choose: boolean) {
  setText(syncError, null)
  result.hidden = true
  syncButton.disabled = true
  syncButton.textContent = "Syncing…"
  try {
    const lines = await sync(choose)
    if (!lines) return
    $("result-lines").replaceChildren(
      ...lines.map((line) => {
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
    setText(syncError, error instanceof StudentOsError ? error.message : "Something went wrong. Please try again.")
  } finally {
    setText(progress, null)
    syncButton.disabled = false
    syncButton.textContent = "Sync now"
  }
}

syncButton.addEventListener("click", () => void runSync(false))
$("choose-courses").addEventListener("click", (event) => {
  event.preventDefault()
  if (!syncButton.disabled) void runSync(true)
})
$("open-student-os").addEventListener("click", (event) => {
  event.preventDefault()
  void chrome.tabs.create({ url: `${address}/tasks` })
})

void chrome.storage.local.get(ADDRESS_KEY).then((stored) => {
  if (typeof stored[ADDRESS_KEY] === "string") address = stored[ADDRESS_KEY]
  void checkLogin()
})
