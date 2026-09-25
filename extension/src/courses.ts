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

// Current: today is within the term's dates, or (no term dates) the course's own.
// Unknown dates are never "current".
export function isCurrent(option: CourseOption, now: number): boolean {
  const start = option.term?.start ?? option.start
  const end = option.term?.end ?? option.end
  if (start === null && end === null) return false
  return (start === null || start <= now) && (end === null || now <= end)
}

// Grouped by term: current semester first, then newest to oldest, then courses
// without a term ("Other courses").
export function groupByTerm(options: CourseOption[], now: number): TermGroup[] {
  const groups = new Map<string, TermGroup>()
  const starts = new Map<string, number>()
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
    if (isCurrent(option, now)) group.current = true
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
  if (!saved) return { selected: new Set(options.filter((o) => isCurrent(o, now)).map((o) => o.id)), needsReview: true }
  const seen = new Set(saved.seen)
  const unseen = options.filter((o) => !seen.has(o.id))
  const selected = new Set(saved.selected.filter((id) => options.some((o) => o.id === id)))
  for (const option of unseen) if (isCurrent(option, now)) selected.add(option.id)
  return { selected, needsReview: unseen.length > 0 }
}
