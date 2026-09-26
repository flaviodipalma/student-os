// Reading Blackboard Learn, inside the student's Blackboard tab. The popup (or the
// background worker) runs readBlackboard there with chrome.scripting.executeScript,
// so its requests are same-origin and carry the student's own Blackboard login,
// exactly like Blackboard's own pages (Ultra uses the same REST API). Nothing is
// written to Blackboard.
//
// Two steps, so the student can choose courses in between:
//   { kind: "courses" }                    their courses (as a student) with the term
//   { kind: "assignments", courseIds }     those courses' instructors (names only), grade
//                                          columns, the student's grades and recent attempts
//
// Always full addresses (origin + path): Ultra pages set a <base href> to their CDN,
// so a relative address would go to the CDN instead of Blackboard.
//
// executeScript copies the function's source into the tab: it must be completely
// self-contained (every helper defined inside it). The step is passed as an
// argument; origin, fetchFn and now exist for tests.

export type BlackboardStep = { kind: "courses" } | { kind: "assignments"; courseIds: string[] }

export type BlackboardRead =
  | {
      ok: true
      kind: "courses"
      baseUrl: string
      // Memberships (course expanded), sent to Student OS for the chosen courses.
      courses: Record<string, unknown>[]
      // The same courses shaped for the course list: id, name, course_code, term.
      choices: Record<string, unknown>[]
    }
  | {
      ok: true
      kind: "assignments"
      baseUrl: string
      // Course id -> its instructors' names ("Jane Smith").
      instructors: Record<string, string[]>
      columns: Record<string, unknown[]>
      grades: Record<string, unknown[]>
      attempts: Record<string, unknown[]>
      coursesUnreadable: number
    }
  | { ok: false; reason: "not-blackboard" | "logged-out" | "error" }

export async function readBlackboard(
  step: BlackboardStep,
  origin: string = location.origin,
  fetchFn: typeof fetch = fetch,
  now: number = Date.now()
): Promise<BlackboardRead> {
  // Same limits as the Student OS import endpoint and the OAuth adapter.
  const MAX_COURSES = 100
  const MAX_COLUMNS = 500
  const MAX_PAGES = 20
  const MAX_DESCRIPTION = 4000
  const PARALLEL = 4
  const ATTEMPT_WINDOW_DAYS = 30
  const MAX_ATTEMPT_LOOKUPS = 25
  const ID = /^_\d+_\d+$/
  const api = `${origin}/learn/api/public`

  class HttpError extends Error {
    constructor(readonly status: number) {
      super(`Blackboard answered ${status}`)
    }
  }

  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const pick = (value: unknown, keys: string[]) => {
    const source = record(value)
    return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]))
  }

  async function get(url: string): Promise<unknown> {
    const response = await fetchFn(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
    if (!response.ok) throw new HttpError(response.status)
    return response.json()
  }

  // Every item of a paged list: { results: [...], paging: { nextPage: "/learn/api/public/..." } },
  // following next pages only on this same Blackboard.
  async function all(path: string, limit: number): Promise<unknown[]> {
    const items: unknown[] = []
    let url: string | null = `${api}/${path}`
    for (let pages = 0; url && pages < MAX_PAGES && items.length < limit; pages++) {
      const data = record(await get(url))
      if (!Array.isArray(data.results)) throw new HttpError(0)
      items.push(...data.results)
      const next = record(data.paging).nextPage
      const nextUrl = typeof next === "string" ? new URL(next, origin) : null
      url = nextUrl && nextUrl.origin === origin ? nextUrl.href : null
    }
    return items.slice(0, limit)
  }

  // Is this Blackboard, and is the student logged in? (Also: who, for grades and attempts.)
  let userId: string
  try {
    const me = record(await get(`${api}/v1/users/me?fields=id`))
    if (typeof me.id !== "string" || !ID.test(me.id)) return { ok: false, reason: "not-blackboard" }
    userId = me.id
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return { ok: false, reason: "logged-out" }
    return { ok: false, reason: "not-blackboard" }
  }

  try {
    if (step.kind === "courses") {
      const memberships = await all(
        `v1/users/${userId}/courses?expand=course&fields=courseId,courseRoleId,availability.available,course.id,course.courseId,course.name,course.description,course.organization,course.availability.available,course.externalAccessUrl,course.termId`,
        MAX_COURSES
      )
      // The student's courses only (the same rules as the import): as a student,
      // open to them, not an organization.
      const eligible = memberships.map(record).filter((membership) => {
        const course = record(membership.course)
        const available = record(course.availability).available
        return (
          membership.courseRoleId === "Student" &&
          record(membership.availability).available !== "No" &&
          course.organization !== true &&
          typeof course.id === "string" &&
          ID.test(course.id) &&
          (available === undefined || available === "Yes" || available === "Term")
        )
      })

      // Terms, for grouping courses by semester (optional: without them, courses
      // are simply listed together).
      const terms = new Map<string, Record<string, unknown>>()
      try {
        for (const raw of await all("v1/terms?fields=id,name,availability.duration", 500)) {
          const term = record(raw)
          const duration = record(record(term.availability).duration)
          if (typeof term.id !== "string" || typeof term.name !== "string") continue
          terms.set(term.id, {
            id: term.id,
            name: term.name,
            start_at: duration.type === "DateRange" ? duration.start ?? null : null,
            end_at: duration.type === "DateRange" ? duration.end ?? null : null,
          })
        }
      } catch {
        // Some schools don't let students list terms.
      }

      const termOf = (membership: Record<string, unknown>) => {
        const termId = record(membership.course).termId
        return typeof termId === "string" ? terms.get(termId) : undefined
      }
      const courses = eligible.map((membership) => {
        const term = termOf(membership)
        return {
          ...pick(membership, ["courseId", "courseRoleId", "availability"]),
          course: {
            ...pick(membership.course, ["id", "courseId", "name", "description", "organization", "availability", "externalAccessUrl"]),
            // The semester's dates (class times in Student OS default to them).
            ...(term ? { term: { start_at: term.start_at, end_at: term.end_at } } : {}),
          },
        }
      })
      const choices = eligible.map((membership) => {
        const course = record(membership.course)
        const term = termOf(membership)
        return { id: course.id, name: course.name, course_code: course.courseId, ...(term ? { term } : {}) }
      })
      return { ok: true, kind: "courses", baseUrl: origin, courses, choices }
    }

    const instructors: Record<string, string[]> = {}
    const columns: Record<string, unknown[]> = {}
    const grades: Record<string, unknown[]> = {}
    const attempts: Record<string, unknown[]> = {}
    let coursesUnreadable = 0
    const ids = step.courseIds.filter((id) => ID.test(id)).slice(0, MAX_COURSES)

    const readCourse = async (courseId: string) => {
      let list: Record<string, unknown>[]
      try {
        list = (
          await all(
            `v2/courses/${courseId}/gradebook/columns?fields=id,name,displayName,description,externalGrade,contentId,scoreProviderHandle,availability.available,grading.type,grading.due`,
            MAX_COLUMNS
          )
        ).map(record)
      } catch {
        coursesUnreadable++
        return
      }
      columns[courseId] = list.map((column) => {
        const kept = pick(column, ["id", "name", "displayName", "externalGrade", "contentId", "scoreProviderHandle", "availability", "grading"])
        if (typeof column.description === "string") kept.description = column.description.slice(0, MAX_DESCRIPTION)
        return kept
      })

      // The course's instructors: names only (the professor on the course in Student OS).
      // Optional: some schools don't show them to students.
      try {
        const members = await all(`v1/courses/${courseId}/users?role=Instructor&expand=user&fields=courseRoleId,user.name.given,user.name.family`, 10)
        const names = members
          .map(record)
          .filter((member) => member.courseRoleId === "Instructor")
          .map((member) => {
            const name = record(record(member.user).name)
            return [name.given, name.family].filter((part) => typeof part === "string" && part.trim()).join(" ").trim()
          })
          .filter(Boolean)
        if (names.length > 0) instructors[courseId] = names
      } catch {
        // Not shown to students here: the course just has no professor.
      }

      // The student's own grades (a score or text means graded). Without them, statuses stay unknown.
      const graded = new Set<string>()
      try {
        const own = (await all(`v2/courses/${courseId}/gradebook/users/${userId}?fields=columnId,score,text`, MAX_COLUMNS)).map(record)
        grades[courseId] = own.map((grade) => pick(grade, ["columnId", "score", "text"]))
        for (const grade of own) {
          if (typeof grade.columnId === "string" && (typeof grade.score === "number" || (typeof grade.text === "string" && grade.text.trim()))) {
            graded.add(grade.columnId)
          }
        }
      } catch {
        // e.g. grades hidden in this course.
      }

      // Recent assignments only (like the OAuth adapter): attempt-graded, not graded
      // yet, due within the last 30 days or later, the closest to today first.
      const from = now - ATTEMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const toCheck = list
        .filter((column) => typeof column.id === "string" && ID.test(column.id) && !graded.has(column.id))
        .map((column) => ({ id: column.id as string, grading: record(column.grading) }))
        .filter(({ grading }) => grading.type === "Attempts" && typeof grading.due === "string")
        .map(({ id, grading }) => ({ id, due: Date.parse(grading.due as string) }))
        .filter(({ due }) => !Number.isNaN(due) && due >= from)
        .sort((a, b) => Math.abs(a.due - now) - Math.abs(b.due - now))
        .slice(0, MAX_ATTEMPT_LOOKUPS)
      for (const { id } of toCheck) {
        try {
          const list = await all(`v2/courses/${courseId}/gradebook/columns/${id}/attempts?userId=${userId}&fields=status`, 100)
          attempts[id] = list.map((attempt) => pick(attempt, ["status"]))
        } catch {
          // e.g. anonymous grading: this one stays unknown.
        }
      }
    }

    // A few courses at a time, so Blackboard isn't flooded.
    for (let i = 0; i < ids.length; i += PARALLEL) await Promise.all(ids.slice(i, i + PARALLEL).map(readCourse))
    return { ok: true, kind: "assignments", baseUrl: origin, instructors, columns, grades, attempts, coursesUnreadable }
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return { ok: false, reason: "logged-out" }
    return { ok: false, reason: "error" }
  }
}
