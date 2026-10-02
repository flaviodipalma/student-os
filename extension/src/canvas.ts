// Reading Canvas, inside the student's Canvas tab. The popup runs readCanvas there
// with chrome.scripting.executeScript, so its requests are same-origin and carry the
// student's own Canvas login, exactly like Canvas's own pages. Nothing is written to Canvas.
//
// Two steps, so the student can choose courses in between:
//   { kind: "courses" }                    the student's active courses, with their term
//   { kind: "assignments", courseIds }     those courses' assignments, calendar events
//                                          and recent announcements
//
// executeScript copies the function's source into the tab: it must be completely
// self-contained (every helper defined inside it, nothing from this module). The
// step is passed as an argument; origin, fetchFn and now exist for tests.

export type CanvasStep = { kind: "courses" } | { kind: "assignments"; courseIds: string[] }

export type CanvasRead =
  | { ok: true; kind: "courses"; baseUrl: string; courses: Record<string, unknown>[] }
  | {
      ok: true
      kind: "assignments"
      baseUrl: string
      // Course id -> its assignments. A course that couldn't be read is left out.
      assignments: Record<string, unknown[]>
      // Course id -> its calendar events / announcements from the last 3 weeks. Optional:
      // a course whose calendar or announcements can't be read is left out of that list.
      events: Record<string, unknown[]>
      announcements: Record<string, unknown[]>
      coursesUnreadable: number
    }
  | { ok: false; reason: "not-canvas" | "logged-out" | "error" }

export async function readCanvas(
  step: CanvasStep,
  origin: string = location.origin,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now()
): Promise<CanvasRead> {
  // Same limits as the Quadernio import endpoint.
  const MAX_COURSES = 100
  const MAX_ASSIGNMENTS = 500
  const MAX_PAGES = 20
  const MAX_DESCRIPTION = 4000
  const PARALLEL = 4
  // Calendar events from about a semester back to half a year ahead; announcements
  // from the last 3 weeks (older ones have been acted on already).
  const DAY = 24 * 60 * 60 * 1000
  const EVENTS_FROM = new Date(now - 120 * DAY).toISOString()
  const EVENTS_UNTIL = new Date(now + 180 * DAY).toISOString()
  const ANNOUNCEMENTS_FROM = new Date(now - 21 * DAY).toISOString()
  const MAX_EVENTS = 200
  const MAX_ANNOUNCEMENTS = 15
  const MAX_ANNOUNCEMENT_TEXT = 4000

  class CanvasHttpError extends Error {
    constructor(readonly status: number) {
      super(`Canvas answered ${status}`)
    }
  }

  // One page: JSON (Canvas may prefix it with "while(1);") and the next page's
  // address from the Link header, only if it's on this same Canvas.
  async function page(url: string): Promise<{ data: unknown; next: string | null }> {
    const response = await fetchFn(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
    if (!response.ok) throw new CanvasHttpError(response.status)
    const data: unknown = JSON.parse((await response.text()).replace(/^while\(1\);/, ""))
    const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1] ?? null
    return { data, next: next && new URL(next, origin).origin === origin ? next : null }
  }

  async function all(path: string, limit: number): Promise<unknown[]> {
    const items: unknown[] = []
    let url: string | null = `${origin}/api/v1${path}${path.includes("?") ? "&" : "?"}per_page=100`
    for (let pages = 0; url && pages < MAX_PAGES && items.length < limit; pages++) {
      const { data, next } = await page(url)
      if (!Array.isArray(data)) throw new CanvasHttpError(0)
      items.push(...data)
      url = next
    }
    return items.slice(0, limit)
  }

  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  // Only the fields Quadernio uses (see src/server/integrations/lms/canvas/mapping.ts).
  const pick = (value: unknown, keys: string[]) => {
    const source = record(value)
    return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]))
  }
  const trimCourse = (value: unknown) => {
    const course = pick(value, [
      "id",
      "name",
      "course_code",
      "workflow_state",
      "access_restricted_by_date",
      "public_description",
      // For choosing courses by semester (Quadernio ignores these).
      "start_at",
      "end_at",
    ])
    const { teachers, term } = record(value)
    if (Array.isArray(teachers)) course.teachers = teachers.map((teacher) => pick(teacher, ["display_name"]))
    if (term) course.term = pick(term, ["id", "name", "start_at", "end_at"])
    return course
  }
  const trimAssignment = (value: unknown) => {
    const assignment = pick(value, [
      "id",
      "course_id",
      "name",
      "due_at",
      "html_url",
      "submission_types",
      "is_quiz_assignment",
      "quiz_id",
      "published",
    ])
    const { description, submission } = record(value)
    if (typeof description === "string") assignment.description = description.slice(0, MAX_DESCRIPTION)
    if (submission) assignment.submission = pick(submission, ["workflow_state"])
    return assignment
  }

  // Is this Canvas, and is the student logged in?
  try {
    const { data } = await page(`${origin}/api/v1/users/self`)
    if (record(data).id === undefined) return { ok: false, reason: "not-canvas" }
  } catch (error) {
    if (error instanceof CanvasHttpError && error.status === 401) return { ok: false, reason: "logged-out" }
    return { ok: false, reason: "not-canvas" }
  }

  try {
    if (step.kind === "courses") {
      const courses = await all("/courses?enrollment_type=student&enrollment_state=active&include[]=teachers&include[]=term", MAX_COURSES)
      return { ok: true, kind: "courses", baseUrl: origin, courses: courses.map(trimCourse) }
    }
    const assignments: Record<string, unknown[]> = {}
    const events: Record<string, unknown[]> = {}
    const announcements: Record<string, unknown[]> = {}
    let coursesUnreadable = 0
    const ids = step.courseIds.filter((id) => /^\d+$/.test(id)).slice(0, MAX_COURSES)
    // A few courses at a time, so Canvas isn't flooded.
    for (let i = 0; i < ids.length; i += PARALLEL) {
      await Promise.all(
        ids.slice(i, i + PARALLEL).map(async (id) => {
          try {
            const list = await all(`/courses/${id}/assignments?include[]=submission&order_by=due_at`, MAX_ASSIGNMENTS)
            assignments[id] = list.map(trimAssignment)
          } catch {
            coursesUnreadable++
            return
          }
          // The course calendar (events only: assignments are read above).
          try {
            const list = await all(
              `/calendar_events?type=event&context_codes[]=course_${id}&start_date=${encodeURIComponent(EVENTS_FROM)}&end_date=${encodeURIComponent(EVENTS_UNTIL)}`,
              MAX_EVENTS
            )
            events[id] = list.map((event) => {
              const kept = pick(event, ["id", "title", "start_at", "end_at", "all_day", "all_day_date", "location_name", "html_url", "workflow_state"])
              const { description } = record(event)
              if (typeof description === "string") kept.description = description.slice(0, MAX_DESCRIPTION)
              return kept
            })
          } catch {
            // Not readable here: the course's calendar is just not imported.
          }
          // Announcements from the last 3 weeks (newest first).
          try {
            const list = await all(
              `/announcements?context_codes[]=course_${id}&start_date=${encodeURIComponent(ANNOUNCEMENTS_FROM)}&end_date=${encodeURIComponent(new Date(now + DAY).toISOString())}`,
              MAX_ANNOUNCEMENTS
            )
            announcements[id] = list.map((item) => {
              const kept = pick(item, ["id", "title", "posted_at", "html_url"])
              const { message } = record(item)
              if (typeof message === "string") kept.message = message.slice(0, MAX_ANNOUNCEMENT_TEXT)
              return kept
            })
          } catch {
            // Not readable here: no suggestions from this course's announcements.
          }
        })
      )
    }
    return { ok: true, kind: "assignments", baseUrl: origin, assignments, events, announcements, coursesUnreadable }
  } catch (error) {
    if (error instanceof CanvasHttpError && error.status === 401) return { ok: false, reason: "logged-out" }
    return { ok: false, reason: "error" }
  }
}
