import type { Course, Priority, Task, TaskType } from "@/lib/types"
import { findDuplicateTask, findMatchingCourse } from "./duplicates"
import type { SyllabusExtraction } from "./schema"

// The editable version of what the AI found, shown on the review screen.
// Form fields are strings (what inputs hold); import.ts turns them into real records.

export type ReviewItem = {
  key: string
  selected: boolean
  title: string
  type: TaskType
  dueDate: string // "" when unknown
  dueTime: string // "" when not given
  // The date exactly as the syllabus wrote it, shown next to the field so mistakes are easy to spot.
  sourceDate: string | null
  description: string
  // "" means "use the default estimate for this type".
  estimateMinutes: string
  // True when the duration came from the syllabus itself.
  estimateFromSyllabus: boolean
  priority: Priority
  needsReview: boolean
  reviewReason: string | null
}

export type ReviewCourse = { code: string; name: string; professor: string; description: string }

export type ReviewTarget = { kind: "new" } | { kind: "existing"; courseId: string }

export type ReviewDraft = {
  course: ReviewCourse
  target: ReviewTarget
  items: ReviewItem[]
  warnings: string[]
  term: string | null
}

// Used when neither the syllabus nor the student gives a duration. Shown in the
// review screen as a default the student can change, never as an AI claim.
export const defaultEstimateMinutes: Record<TaskType, number> = {
  assignment: 90,
  exam: 180,
  quiz: 45,
  project: 240,
  paper: 180,
  reading: 45,
  lab: 120,
  presentation: 120,
  study: 60,
  other: 60,
}

let keyCounter = 0
export const newItemKey = () => `item-${Date.now().toString(36)}-${++keyCounter}`

export function blankReviewItem(): ReviewItem {
  return {
    key: newItemKey(),
    selected: true,
    title: "",
    type: "assignment",
    dueDate: "",
    dueTime: "",
    sourceDate: null,
    description: "",
    estimateMinutes: "",
    estimateFromSyllabus: false,
    priority: "medium",
    needsReview: false,
    reviewReason: null,
  }
}

export function buildReviewDraft(extraction: SyllabusExtraction, courses: Course[], tasks: Task[]): ReviewDraft {
  const { course, items, warnings } = extraction
  const existing = findMatchingCourse(course.courseCode, courses)
  const target: ReviewTarget = existing ? { kind: "existing", courseId: existing.id } : { kind: "new" }

  const draft: ReviewDraft = {
    course: {
      code: course.courseCode ?? existing?.code ?? "",
      name: course.courseName ?? existing?.name ?? "",
      professor: course.professor ?? existing?.professor ?? "",
      description: course.description ?? existing?.description ?? "",
    },
    target,
    term: course.term,
    warnings,
    items: items.map((item) => ({
      key: newItemKey(),
      selected: true,
      title: item.title,
      type: item.type,
      dueDate: item.dueDate ?? "",
      dueTime: item.dueTime ?? "",
      sourceDate: item.dateText,
      description: item.description ?? "",
      estimateMinutes: item.estimatedMinutes ? String(item.estimatedMinutes) : "",
      estimateFromSyllabus: item.estimatedMinutes !== null,
      // No stated priority: exams default to high, everything else to medium.
      priority: item.priority ?? (item.type === "exam" ? "high" : "medium"),
      needsReview: item.needsReview,
      reviewReason: item.reviewReason,
    })),
  }

  // Likely duplicates start unselected, so importing twice doesn't double up.
  const duplicates = findDraftDuplicates(draft, tasks)
  draft.items = draft.items.map((item) => (duplicates.has(item.key) ? { ...item, selected: false } : item))
  return draft
}

// Which review items look like tasks the student already has (keyed by item key).
export function findDraftDuplicates(draft: ReviewDraft, tasks: Task[]): Map<string, Task> {
  const found = new Map<string, Task>()
  if (draft.target.kind !== "existing") return found
  for (const item of draft.items) {
    const duplicate = findDuplicateTask(item, draft.target.courseId, tasks)
    if (duplicate) found.set(item.key, duplicate)
  }
  return found
}
