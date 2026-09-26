import type { Course, RecurringCommitment } from "@/lib/types"

// A course's class times are "class" recurring commitments linked to the course
// (see setClassTimes in src/server/services/recurring-commitments.ts).

// "CSC 215 · Data Structures", within the 100-character commitment title limit.
export const classTitle = (code: string, name: string) => `${code} · ${name}`.slice(0, 100)

export const classTimesOf = (commitments: RecurringCommitment[], courseId: string) =>
  commitments.filter((commitment) => commitment.courseId === courseId)

// Class times named after their course as it's called now.
export function withCourseTitles(commitments: RecurringCommitment[], courses: Course[]): RecurringCommitment[] {
  const byId = new Map(courses.map((course) => [course.id, course]))
  return commitments.map((commitment) => {
    const course = commitment.courseId ? byId.get(commitment.courseId) : undefined
    return course ? { ...commitment, title: classTitle(course.code, course.name) } : commitment
  })
}

// The semester's first and last day when the LMS doesn't say: a best guess from
// today (US calendar): fall Aug 25 – Dec 20, spring Jan 15 – May 20, summer
// Jun 1 – Aug 15. Always editable.
export function likelySemesterStart(today: string): string {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  if (month >= 8) return `${year}-08-25`
  if (month <= 5) return `${year}-01-15`
  return `${year}-06-01`
}

export function likelySemesterEnd(today: string): string {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  if (month >= 8) return `${year}-12-20`
  if (month <= 5) return `${year}-05-20`
  return `${year}-08-15`
}
