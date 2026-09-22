import { daysBetween, fromDateKey, toDateKey } from "@/lib/format"
import { SyllabusImportError } from "./errors"
import { syllabusExtractionSchema, type SyllabusExtraction, type SyllabusItem } from "./schema"

// Never trust raw AI output. This checks the shape against the schema, then the
// values themselves: real calendar dates, valid times, sensible durations.
// Values that fail are cleared and the item is flagged for the student to review,
// rather than silently kept or silently dropped.

const MAX_ITEMS = 300
const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

function clean(value: string | null, maxLength: number): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim() ?? ""
  return trimmed ? trimmed.slice(0, maxLength) : null
}

function isRealDate(value: string): boolean {
  return DATE.test(value) && toDateKey(fromDateKey(value)) === value
}

function flag(item: SyllabusItem, reason: string): SyllabusItem {
  return {
    ...item,
    needsReview: true,
    reviewReason: item.reviewReason ? `${item.reviewReason} ${reason}` : reason,
  }
}

function checkItem(raw: SyllabusItem, today: string): SyllabusItem | null {
  const title = clean(raw.title, 200)
  if (!title) return null

  let item: SyllabusItem = {
    ...raw,
    title,
    dateText: clean(raw.dateText, 120),
    description: clean(raw.description, 1000),
    reviewReason: clean(raw.reviewReason, 300),
  }

  if (item.dueDate !== null && !isRealDate(item.dueDate.trim())) {
    item = flag({ ...item, dueDate: null }, "The date couldn't be read. Please set it.")
  } else if (item.dueDate !== null) {
    item.dueDate = item.dueDate.trim()
    // A date far in the past or future usually means the year was guessed wrong.
    const offset = daysBetween(fromDateKey(today), fromDateKey(item.dueDate))
    if (offset < -400 || offset > 500) item = flag(item, "This date looks unusual. Check the year.")
  }

  if (item.dueTime !== null && !TIME.test(item.dueTime.trim())) item = { ...item, dueTime: null }
  else if (item.dueTime !== null) item.dueTime = item.dueTime.trim()

  // Durations are only kept when they're plausible (5 minutes to 24 hours).
  if (item.estimatedMinutes !== null && (item.estimatedMinutes < 5 || item.estimatedMinutes > 24 * 60)) {
    item = { ...item, estimatedMinutes: null }
  }

  if (item.dueDate === null && !item.needsReview) item = flag(item, "No specific date found.")
  return item
}

export function validateExtraction(raw: unknown, today: string): SyllabusExtraction {
  const parsed = syllabusExtractionSchema.safeParse(raw)
  if (!parsed.success) throw new SyllabusImportError("ai-invalid-response", { cause: parsed.error })

  const { course, items, warnings } = parsed.data
  const cleanedCourse = {
    courseCode: clean(course.courseCode, 30),
    courseName: clean(course.courseName, 150),
    professor: clean(course.professor, 120),
    description: clean(course.description, 600),
    term: clean(course.term, 60),
  }

  // Check each item and drop exact repeats (same title, type and date).
  const seen = new Set<string>()
  const cleanedItems: SyllabusItem[] = []
  for (const rawItem of items.slice(0, MAX_ITEMS)) {
    const item = checkItem(rawItem, today)
    if (!item) continue
    const key = `${item.title.toLowerCase()}|${item.type}|${item.dueDate}`
    if (seen.has(key)) continue
    seen.add(key)
    cleanedItems.push(item)
  }

  const hasCourseInfo = cleanedCourse.courseCode || cleanedCourse.courseName
  if (!hasCourseInfo && cleanedItems.length === 0) throw new SyllabusImportError("not-a-syllabus")

  return {
    course: cleanedCourse,
    items: cleanedItems,
    warnings: warnings.map((w) => clean(w, 300)).filter((w): w is string => w !== null).slice(0, 10),
  }
}
