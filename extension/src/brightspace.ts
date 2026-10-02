// Reading D2L Brightspace, inside the student's Brightspace tab. The popup (or the
// background worker) runs readBrightspace there with chrome.scripting.executeScript,
// so its requests are same-origin and carry the student's own Brightspace login,
// exactly like Brightspace's own pages (they use the same Valence API). Nothing is
// written to Brightspace.
//
// Two steps, so the student can choose courses in between:
//   { kind: "courses" }                    their course offerings, each with its semester
//   { kind: "assignments", courseIds }     those courses' assignment folders, quizzes,
//                                          the student's own submissions (recent folders only),
//                                          calendar events and recent announcements (news)
//
// Brightspace accepts the session's cookies for these reads. Where a school only
// accepts a token, the page's own short-lived token is used instead (the same one
// Brightspace's newer pages fetch, with the page's own anti-forgery token).
//
// executeScript copies the function's source into the tab: it must be completely
// self-contained (every helper defined inside it). The step is passed as an
// argument; origin, fetchFn, storage and now exist for tests.

export type BrightspaceStep = { kind: "courses" } | { kind: "assignments"; courseIds: string[] }

export type BrightspaceRead =
  | {
      ok: true
      kind: "courses"
      baseUrl: string
      // Enrollments (OrgUnit, Access) with their course offering's dates, sent to Quadernio.
      courses: Record<string, unknown>[]
      // The same courses shaped for the course list: id, name, course_code, term.
      choices: Record<string, unknown>[]
    }
  | {
      ok: true
      kind: "assignments"
      baseUrl: string
      folders: Record<string, unknown[]>
      quizzes: Record<string, unknown[]>
      submissions: Record<string, unknown[]>
      // Course id -> its calendar events / announcements from the last 3 weeks (optional).
      events: Record<string, unknown[]>
      announcements: Record<string, unknown[]>
      coursesUnreadable: number
    }
  | { ok: false; reason: "not-brightspace" | "logged-out" | "error" }

export async function readBrightspace(
  step: BrightspaceStep,
  origin: string = location.origin,
  fetchFn: typeof fetch = fetch,
  storage: Pick<Storage, "getItem"> | null = typeof localStorage === "undefined" ? null : localStorage,
  now: number = Date.now()
): Promise<BrightspaceRead> {
  // Same limits as the Quadernio import endpoint.
  const MAX_COURSES = 100
  const MAX_ENROLLMENTS = 500
  const MAX_ITEMS = 500
  const MAX_PAGES = 20
  const MAX_DESCRIPTION = 4000
  const PARALLEL = 4
  const SUBMISSION_WINDOW_DAYS = 30
  const MAX_SUBMISSION_LOOKUPS = 25
  const ID = /^\d{1,18}$/
  const DAY = 24 * 60 * 60 * 1000
  const EVENTS_FROM = new Date(now - 120 * DAY).toISOString()
  const EVENTS_UNTIL = new Date(now + 180 * DAY).toISOString()
  const ANNOUNCEMENTS_FROM = now - 21 * DAY
  const MAX_EVENTS = 200
  const MAX_ANNOUNCEMENTS = 15
  const MAX_ANNOUNCEMENT_TEXT = 4000

  class HttpError extends Error {
    constructor(readonly status: number) {
      super(`Brightspace answered ${status}`)
    }
  }

  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
  const pick = (value: unknown, keys: string[]) => {
    const source = record(value)
    return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]))
  }
  const idOf = (value: unknown) => (typeof value === "number" || typeof value === "string" ? String(value) : "")
  const cut = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_DESCRIPTION) : value)

  let token: string | null = null
  async function get(url: string): Promise<unknown> {
    const headers: Record<string, string> = { Accept: "application/json" }
    if (token) headers.Authorization = `Bearer ${token}`
    const response = await fetchFn(url, { credentials: "same-origin", headers })
    if (!response.ok) throw new HttpError(response.status)
    return response.json()
  }

  // The page's own short-lived API token (only where cookies alone aren't accepted).
  async function pageToken(): Promise<string | null> {
    const csrf = storage?.getItem("XSRF.Token")
    if (!csrf) return null
    try {
      const response = await fetchFn(`${origin}/d2l/lp/auth/oauth2/token`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Csrf-Token": csrf },
        body: "scope=*:*:*",
      })
      if (!response.ok) return null
      const accessToken = record(await response.json()).access_token
      return typeof accessToken === "string" ? accessToken : null
    } catch {
      return null
    }
  }

  // Is this Brightspace? Its version list is public; it names the API products.
  let lp: string
  let le: string
  try {
    const products = await get(`${origin}/d2l/api/versions/`)
    if (!Array.isArray(products)) return { ok: false, reason: "not-brightspace" }
    const latest = (code: string) => {
      const product = products.map(record).find((item) => item.ProductCode === code)
      return typeof product?.LatestVersion === "string" && /^\d+\.\d+$/.test(product.LatestVersion) ? product.LatestVersion : null
    }
    const lpVersion = latest("lp")
    const leVersion = latest("le")
    if (!lpVersion || !leVersion) return { ok: false, reason: "not-brightspace" }
    lp = `${origin}/d2l/api/lp/${lpVersion}`
    le = `${origin}/d2l/api/le/${leVersion}`
  } catch {
    return { ok: false, reason: "not-brightspace" }
  }

  // Is the student logged in?
  try {
    await get(`${lp}/users/whoami`)
  } catch (error) {
    if (!(error instanceof HttpError) || (error.status !== 401 && error.status !== 403)) return { ok: false, reason: "error" }
    token = await pageToken()
    if (!token) return { ok: false, reason: "logged-out" }
    try {
      await get(`${lp}/users/whoami`)
    } catch {
      return { ok: false, reason: "logged-out" }
    }
  }

  try {
    if (step.kind === "courses") {
      // Course offerings (org unit type 3), following the paging bookmark.
      const items: unknown[] = []
      let bookmark: string | null = null
      for (let pages = 0; pages < MAX_PAGES && items.length < MAX_ENROLLMENTS; pages++) {
        const page = record(
          await get(`${lp}/enrollments/myenrollments/?orgUnitTypeId=3${bookmark ? `&bookmark=${encodeURIComponent(bookmark)}` : ""}`)
        )
        if (!Array.isArray(page.Items)) throw new HttpError(0)
        items.push(...page.Items)
        const paging = record(page.PagingInfo)
        bookmark = paging.HasMoreItems === true && typeof paging.Bookmark === "string" ? paging.Bookmark : null
        if (!bookmark) break
      }

      // Courses the student takes and can open, most recent first (the same rules as
      // the import: role names are per school, so the standard LIS roles decide).
      const learner = (role: unknown) => typeof role === "string" && /learner|student/i.test(role)
      const teaching = (role: unknown) =>
        typeof role === "string" && /instructor|teacher|teaching\s*assistant|administrator|mentor|content\s*developer|designer/i.test(role)
      const eligible = items
        .map(record)
        .filter((item) => {
          const access = record(item.Access)
          const roles = [...(Array.isArray(access.LISRoles) ? access.LISRoles : []), access.ClasslistRoleName].filter((role) => typeof role === "string" && role)
          const takes = roles.length === 0 || roles.some(learner) || !roles.some(teaching)
          return ID.test(idOf(record(item.OrgUnit).Id)) && access.CanAccess !== false && access.IsActive !== false && takes
        })
        .sort((a, b) => String(record(b.Access).StartDate ?? "").localeCompare(String(record(a.Access).StartDate ?? "")))
        .slice(0, MAX_COURSES)

      // Each course's semester (optional: without it, courses are listed by their own
      // dates). From the course offering; where students can't read that, or it names
      // no semester, from the semester the course sits under (org unit type 5).
      const offerings = new Map<string, Record<string, unknown>>()
      const readOffering = async (id: string) => {
        let offering: Record<string, unknown> = {}
        try {
          offering = record(await get(`${lp}/courses/${id}`))
        } catch {
          // Not readable here: try the semester above it.
        }
        if (typeof record(offering.Semester).Name !== "string") {
          try {
            const parents = await get(`${lp}/orgstructure/${id}/parents/?ouTypeId=5`)
            const semester = Array.isArray(parents) ? record(parents.find((parent) => typeof record(parent).Name === "string")) : {}
            if (typeof semester.Name === "string") offering = { ...offering, Semester: { Identifier: semester.Identifier, Name: semester.Name } }
          } catch {
            // Not readable either: the course just has no semester name.
          }
        }
        if (Object.keys(offering).length > 0) offerings.set(id, offering)
      }
      const ids = eligible.map((item) => idOf(record(item.OrgUnit).Id))
      for (let i = 0; i < ids.length; i += PARALLEL) await Promise.all(ids.slice(i, i + PARALLEL).map(readOffering))

      const courses = eligible.map((item) => {
        const id = idOf(record(item.OrgUnit).Id)
        const offering = offerings.get(id)
        const semester = record(offering?.Semester)
        return {
          OrgUnit: pick(item.OrgUnit, ["Id", "Name", "Code", "HomeUrl", "Type"]),
          Access: pick(item.Access, ["IsActive", "CanAccess", "StartDate", "EndDate", "ClasslistRoleName", "LISRoles"]),
          ...(offering
            ? { Offering: { StartDate: offering.StartDate ?? null, EndDate: offering.EndDate ?? null, Semester: pick(semester, ["Identifier", "Name"]) } }
            : {}),
        }
      })
      const choices = courses.map((course) => {
        const unit = record(course.OrgUnit)
        const access = record(course.Access)
        const offering = record((course as { Offering?: unknown }).Offering)
        const semester = record(offering.Semester)
        const start = offering.StartDate ?? access.StartDate ?? null
        const end = offering.EndDate ?? access.EndDate ?? null
        return {
          id: idOf(unit.Id),
          name: unit.Name,
          course_code: unit.Code,
          start_at: start,
          end_at: end,
          ...(typeof semester.Name === "string" && semester.Name.trim()
            ? { term: { id: idOf(semester.Identifier) || semester.Name, name: semester.Name, start_at: start, end_at: end } }
            : {}),
        }
      })
      return { ok: true, kind: "courses", baseUrl: origin, courses, choices }
    }

    const folders: Record<string, unknown[]> = {}
    const quizzes: Record<string, unknown[]> = {}
    const submissions: Record<string, unknown[]> = {}
    const events: Record<string, unknown[]> = {}
    const announcements: Record<string, unknown[]> = {}
    let coursesUnreadable = 0
    const ids = step.courseIds.filter((id) => ID.test(id)).slice(0, MAX_COURSES)

    const readCourse = async (ou: string) => {
      let list: Record<string, unknown>[]
      try {
        const data = await get(`${le}/${ou}/dropbox/folders/`)
        if (!Array.isArray(data)) throw new HttpError(0)
        list = data.map(record).slice(0, MAX_ITEMS)
      } catch {
        coursesUnreadable++
        return
      }
      folders[ou] = list.map((folder) => ({
        ...pick(folder, ["Id", "Name", "DueDate", "IsHidden"]),
        CustomInstructions: { Text: cut(record(folder.CustomInstructions).Text) ?? null },
      }))

      // Quizzes (optional: some schools don't list them to students), following Next.
      try {
        const found: Record<string, unknown>[] = []
        let url: string | null = `${le}/${ou}/quizzes/`
        for (let pages = 0; url && pages < MAX_PAGES && found.length < MAX_ITEMS; pages++) {
          const page = record(await get(url))
          if (!Array.isArray(page.Objects)) throw new HttpError(0)
          found.push(...page.Objects.map(record))
          const next = typeof page.Next === "string" ? new URL(page.Next, origin) : null
          url = next && next.origin === origin ? next.href : null
        }
        quizzes[ou] = found.slice(0, MAX_ITEMS).map((quiz) => ({
          ...pick(quiz, ["QuizId", "Name", "DueDate", "IsActive"]),
          Description: { Text: { Text: cut(record(record(quiz.Description).Text).Text) ?? null } },
        }))
      } catch {
        // Not listed to students here: only assignment folders are imported.
      }

      // The student's own submissions to recent folders: due within the last 30 days
      // or later, the closest to today first.
      const from = now - SUBMISSION_WINDOW_DAYS * 24 * 60 * 60 * 1000
      const toCheck = list
        .filter((folder) => ID.test(idOf(folder.Id)) && folder.IsHidden !== true && typeof folder.DueDate === "string")
        .map((folder) => ({ id: idOf(folder.Id), due: Date.parse(folder.DueDate as string) }))
        .filter(({ due }) => !Number.isNaN(due) && due >= from)
        .sort((a, b) => Math.abs(a.due - now) - Math.abs(b.due - now))
        .slice(0, MAX_SUBMISSION_LOOKUPS)
      for (const { id } of toCheck) {
        try {
          const own = await get(`${le}/${ou}/dropbox/folders/${id}/submissions/mysubmissions/`)
          if (!Array.isArray(own)) continue
          submissions[id] = own.slice(0, 20).map((entry) => ({
            ...pick(entry, ["Status", "CompletionDate"]),
            Submissions: (Array.isArray(record(entry).Submissions) ? (record(entry).Submissions as unknown[]) : []).slice(0, 20).map((item) => pick(item, ["SubmissionDate"])),
          }))
        } catch {
          // This one stays unknown.
        }
      }

      // The course calendar: an array, or a page of { Objects, Next } on newer versions.
      try {
        const found: Record<string, unknown>[] = []
        let url: string | null = `${le}/${ou}/calendar/events/?startDateTime=${encodeURIComponent(EVENTS_FROM)}&endDateTime=${encodeURIComponent(EVENTS_UNTIL)}`
        for (let pages = 0; url && pages < MAX_PAGES && found.length < MAX_EVENTS; pages++) {
          const page = await get(url)
          if (Array.isArray(page)) {
            found.push(...page.map(record))
            url = null
          } else {
            const objects = record(page).Objects
            if (!Array.isArray(objects)) throw new HttpError(0)
            found.push(...objects.map(record))
            const next = typeof record(page).Next === "string" ? new URL(record(page).Next as string, origin) : null
            url = next && next.origin === origin ? next.href : null
          }
        }
        events[ou] = found.slice(0, MAX_EVENTS).map((event) => ({
          ...pick(event, ["CalendarEventId", "Title", "StartDateTime", "EndDateTime", "StartDay", "EndDay", "IsAllDayEvent", "LocationName"]),
          ...(typeof event.Description === "string" ? { Description: event.Description.slice(0, MAX_DESCRIPTION) } : {}),
          // Only what kind of item it's tied to (a folder's or quiz's due date is read above).
          ...(record(event.AssociatedEntity).AssociatedEntityType ? { AssociatedEntityType: record(event.AssociatedEntity).AssociatedEntityType } : {}),
        }))
      } catch {
        // Not readable here: the course's calendar is just not imported.
      }

      // Announcements ("news") from the last 3 weeks.
      try {
        const news = await get(`${le}/${ou}/news/`)
        if (!Array.isArray(news)) throw new HttpError(0)
        announcements[ou] = news
          .map(record)
          .filter((item) => {
            const posted = Date.parse(String(item.StartDate ?? item.CreatedDate ?? ""))
            return item.IsHidden !== true && item.IsPublished !== false && !Number.isNaN(posted) && posted >= ANNOUNCEMENTS_FROM
          })
          .slice(0, MAX_ANNOUNCEMENTS)
          .map((item) => ({
            ...pick(item, ["Id", "Title", "StartDate", "CreatedDate"]),
            Body: { Text: cut(record(item.Body).Text) ?? null, Html: typeof record(item.Body).Html === "string" ? (record(item.Body).Html as string).slice(0, MAX_ANNOUNCEMENT_TEXT) : null },
          }))
      } catch {
        // Not readable here: no suggestions from this course's announcements.
      }
    }

    // A few courses at a time, so Brightspace isn't flooded.
    for (let i = 0; i < ids.length; i += PARALLEL) await Promise.all(ids.slice(i, i + PARALLEL).map(readCourse))
    return { ok: true, kind: "assignments", baseUrl: origin, folders, quizzes, submissions, events, announcements, coursesUnreadable }
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) return { ok: false, reason: "logged-out" }
    return { ok: false, reason: "error" }
  }
}
