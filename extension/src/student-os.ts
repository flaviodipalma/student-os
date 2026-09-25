// Talking to Student OS from the extension, as the student logged in to Student OS in
// this browser. No Chrome APIs here, so it can be tested in Node: the popup passes in `fetch`.

export const DEFAULT_ADDRESS = "http://localhost:3000"
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"])

// Every request to Student OS: the student's login cookies (Chrome sends them because
// the extension has permission for this address) and the header that marks it as the
// extension (see src/server/integrations/extension/http.ts).
const REQUEST = { credentials: "include", cache: "no-store" } as const
const EXTENSION_HEADERS = { "X-Student-OS-Extension": "1" }

export class StudentOsError extends Error {
  // True when nobody is logged in to Student OS in this browser.
  constructor(
    message: string,
    readonly loggedOut = false
  ) {
    super(message)
  }
}

// "studentos.app", "https://studentos.app/integrations" -> "https://studentos.app".
// HTTPS only, except this computer (development): the login cookies travel to it.
export function normalizeAddress(input: string): string {
  const raw = input.trim()
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw new StudentOsError("Enter your Student OS address, like studentos.app.")
  }
  const local = LOCAL_HOSTS.has(url.hostname)
  if (url.username || url.password || !(url.protocol === "https:" || (url.protocol === "http:" && local))) {
    throw new StudentOsError("The Student OS address has to start with https://.")
  }
  if (!local && !url.hostname.includes(".")) throw new StudentOsError("Enter your Student OS address, like studentos.app.")
  return url.origin
}

// Who the extension syncs to: the Student OS account logged in in this browser.
export async function currentAccount(address: string, fetchFn: typeof fetch): Promise<{ firstName: string }> {
  const body = await call(address, "/api/extension/me", { headers: EXTENSION_HEADERS }, fetchFn)
  if (!isRecord(body) || typeof body.firstName !== "string") {
    throw new StudentOsError(`That address doesn't look like Student OS: ${address}`)
  }
  return { firstName: body.firstName }
}

// The parts of Student OS's sync summary the popup shows (LmsSyncResult in src/lib/lms/types.ts).
export type SyncSummary = {
  coursesCreated: number
  coursesUpdated: number
  coursesLinked: number
  coursesSkipped: number
  assignmentsCreated: number
  assignmentsUpdated: number
  assignmentsLinked: number
  assignmentsCompleted: number
  assignmentsWithoutDueDate: number
  conflicts: unknown[]
  errors: string[]
}

// Sends what the extension read from Canvas or Blackboard to Student OS, which
// imports it (/api/extension/<lms>/import).
export async function sendImport(
  address: string,
  lms: "canvas" | "blackboard",
  data: { baseUrl: string; courses: unknown[] } & Record<string, unknown>,
  timeZone: string,
  fetchFn: typeof fetch
): Promise<SyncSummary> {
  const body = await call(
    address,
    `/api/extension/${lms}/import`,
    {
      method: "POST",
      headers: { ...EXTENSION_HEADERS, "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, timeZone }),
    },
    fetchFn
  )
  if (!isRecord(body) || !isRecord(body.result)) throw new StudentOsError("Student OS sent back something unexpected. Please try again.")
  return body.result as SyncSummary
}

// One request to Student OS; its JSON, or a StudentOsError with a message for the student.
async function call(address: string, path: string, init: RequestInit, fetchFn: typeof fetch): Promise<unknown> {
  let response: Response
  try {
    response = await fetchFn(`${address}${path}`, { ...REQUEST, ...init })
  } catch {
    throw new StudentOsError(`Can't reach Student OS at ${address}. Check that it's running and try again.`)
  }
  const body: unknown = await response.json().catch(() => null)
  if (response.status === 401) throw new StudentOsError(errorOf(body) ?? "Log in to Student OS in this browser.", true)
  if (!response.ok) throw new StudentOsError(errorOf(body) ?? `Student OS couldn't do that (${response.status}). Please try again.`)
  return body
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

// The sync, in a few short lines (same wording as the Integrations page).
export function summaryLines(result: SyncSummary, coursesUnreadable: number, lmsName: string): string[] {
  const lines = [
    result.coursesCreated > 0 && `${plural(result.coursesCreated, "course")} added`,
    result.coursesLinked > 0 && `${plural(result.coursesLinked, "existing course")} linked to ${lmsName}`,
    result.coursesUpdated > 0 && `${plural(result.coursesUpdated, "course")} updated`,
    result.assignmentsCreated > 0 && `${plural(result.assignmentsCreated, "assignment")} added as tasks`,
    result.assignmentsLinked > 0 && `${plural(result.assignmentsLinked, "existing task")} linked to ${lmsName}`,
    result.assignmentsUpdated > 0 && `${plural(result.assignmentsUpdated, "assignment")} updated`,
    result.assignmentsCompleted > 0 && `${plural(result.assignmentsCompleted, "task")} marked done (submitted in ${lmsName})`,
    result.assignmentsWithoutDueDate > 0 && `${plural(result.assignmentsWithoutDueDate, "assignment")} without a due date weren't imported`,
    result.coursesSkipped + coursesUnreadable > 0 && `${plural(result.coursesSkipped + coursesUnreadable, "course")} couldn't be read`,
    result.conflicts.length > 0 && `${plural(result.conflicts.length, "change")} of yours kept (see Integrations)`,
  ].filter((line): line is string => typeof line === "string")
  return lines.length > 0 ? lines : ["Everything was already up to date."]
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null
const errorOf = (body: unknown) => (isRecord(body) && typeof body.error === "string" ? body.error : null)
