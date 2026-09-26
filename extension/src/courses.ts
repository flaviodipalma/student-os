// Choosing which Canvas courses to import. Canvas's "active" courses often include
// old semesters (many schools never close them), so the student picks; courses in
// the current semester start checked. No Chrome APIs here (tested in Node).

export type CourseOption = {
  id: string
  label: string
  term: { key: string; name: string; start: number | null; end: number | null } | null
  // The course's own dates, used when its term has none.
  start: number | null
  end: number | null
}

export type TermGroup = { key: string; name: string; current: boolean; courses: CourseOption[] }

// What the extension remembers per Canvas: the chosen courses, and every course it
// has shown the student (a course not seen before brings the list back).
export type CourseChoice = { selected: string[]; seen: string[] }

const time = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : NaN
  return Number.isNaN(ms) ? null : ms
}
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : null)

// Canvas courses (from readCanvas) -> options. Courses Student OS wouldn't import
// anyway (no name, hidden by date, deleted) are left out.
export function courseOptions(courses: Record<string, unknown>[]): CourseOption[] {
  return courses.flatMap((course) => {
    const id = typeof course.id === "number" || typeof course.id === "string" ? String(course.id) : null
    const name = text(course.name) ?? text(course.course_code)
    if (!id || !name || course.access_restricted_by_date === true || course.workflow_state === "deleted") return []
    const code = text(course.course_code)
    const term = typeof course.term === "object" && course.term !== null ? (course.term as Record<string, unknown>) : null
    const termName = text(term?.name)
    return [
      {
        id,
        label: code && code !== name ? `${code} · ${name}` : name,
        term: termName
          ? { key: String(term?.id ?? termName), name: termName, start: time(term?.start_at), end: time(term?.end_at) }
          : null,
        start: time(course.start_at),
        end: time(course.end_at),
      },
    ]
  })
}

// About a semester: how far a date can be from today when the other one is missing.
const SEMESTER_MS = 183 * 24 * 60 * 60 * 1000

// Current: today is within the term's dates, or (no term dates) the course's own.
// Unknown dates are never "current". With only one date known (schools often leave
// an old term's end date empty), it has to be within about a semester of today:
// a term that started more than ~6 months ago and never "ended" is an old one.
export function isCurrent(option: CourseOption, now: number): boolean {
  const start = option.term?.start ?? option.start
  const end = option.term?.end ?? option.end
  if (start === null && end === null) return false
  if (end === null) return start! <= now && now - start! <= SEMESTER_MS
  if (start === null) return now <= end && end - now <= SEMESTER_MS
  return start <= now && now <= end
}

// Some schools keep terms open long after they end (e.g. Fall 2025 "ends" in
// December 2026, so students keep access), so several terms can include today.
// Only the latest one is the current semester, with any that started up to ~4
// months before it (e.g. a first-half session): the courses returned here.
const OVERLAP_MS = 120 * 24 * 60 * 60 * 1000

export function currentCourseIds(options: CourseOption[], now: number): Set<string> {
  const candidates = options.filter((option) => isCurrent(option, now))
  const startOf = (option: CourseOption) => option.term?.start ?? option.start
  const starts = candidates.map(startOf).filter((start): start is number => start !== null)
  const latest = starts.length > 0 ? Math.max(...starts) : null
  return new Set(
    candidates
      .filter((option) => {
        const start = startOf(option)
        return start === null || latest === null || latest - start <= OVERLAP_MS
      })
      .map((option) => option.id)
  )
}

// Grouped by term: current semester first, then newest to oldest, then courses
// without a term ("Other courses").
export function groupByTerm(options: CourseOption[], now: number): TermGroup[] {
  const groups = new Map<string, TermGroup>()
  const starts = new Map<string, number>()
  const current = currentCourseIds(options, now)
  for (const option of options) {
    const key = option.term?.key ?? "none"
    let group = groups.get(key)
    if (!group) {
      const name = option.term && option.term.name !== "Default Term" ? option.term.name : "Other courses"
      group = { key, name, current: false, courses: [] }
      groups.set(key, group)
      starts.set(key, option.term?.start ?? option.start ?? -Infinity)
    }
    group.courses.push(option)
    if (current.has(option.id)) group.current = true
  }
  return [...groups.values()].sort((a, b) => {
    if (a.current !== b.current) return a.current ? -1 : 1
    if ((a.key === "none") !== (b.key === "none")) return a.key === "none" ? 1 : -1
    return (starts.get(b.key) ?? -Infinity) - (starts.get(a.key) ?? -Infinity)
  })
}

// Which courses start checked, and whether the student has to look at the list.
// First time: current-semester courses, and show the list. Later: the saved choice,
// and show the list only when Canvas has a course the student hasn't seen (a new
// semester), with any new current-semester course checked.
export function initialSelection(
  options: CourseOption[],
  saved: CourseChoice | null,
  now: number
): { selected: Set<string>; needsReview: boolean } {
  const current = currentCourseIds(options, now)
  if (!saved) return { selected: current, needsReview: true }
  const seen = new Set(saved.seen)
  const unseen = options.filter((o) => !seen.has(o.id))
  const selected = new Set(saved.selected.filter((id) => options.some((o) => o.id === id)))
  for (const option of unseen) if (current.has(option.id)) selected.add(option.id)
  return { selected, needsReview: unseen.length > 0 }
}
