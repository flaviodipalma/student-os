import { fromDateKey, toDateKey } from "@/lib/format"
import type { CourseInput, TaskInput } from "@/lib/types"
import { defaultEstimateMinutes, type ReviewDraft } from "./review"

// The last step: turning a reviewed, confirmed draft into normal Student OS
// courses and tasks. Nothing here runs until the student confirms.

export type ImportProblem = { itemKey?: string; message: string }

// Everything the student must fix before importing.
export function checkDraft(draft: ReviewDraft): ImportProblem[] {
  const problems: ImportProblem[] = []
  if (draft.target.kind === "new") {
    if (!draft.course.code.trim()) problems.push({ message: "Add the course code." })
    if (!draft.course.name.trim()) problems.push({ message: "Add the course name." })
  }
  const selected = draft.items.filter((item) => item.selected)
  if (selected.length === 0 && draft.target.kind === "existing") {
    problems.push({ message: "Select at least one item to import." })
  }
  for (const item of selected) {
    const label = item.title.trim() || "An item"
    if (!item.title.trim()) problems.push({ itemKey: item.key, message: "An item is missing its title." })
    if (!item.dueDate || toDateKey(fromDateKey(item.dueDate)) !== item.dueDate) {
      problems.push({ itemKey: item.key, message: `${label} needs a due date.` })
    }
    if (item.estimateMinutes && !(Number.isInteger(Number(item.estimateMinutes)) && Number(item.estimateMinutes) > 0)) {
      problems.push({ itemKey: item.key, message: `${label} needs a duration in whole minutes.` })
    }
  }
  return problems
}

export type ImportPlan = {
  course: { kind: "new"; input: CourseInput } | { kind: "existing"; courseId: string }
  tasks: Omit<TaskInput, "courseId">[]
}

export function buildImportPlan(draft: ReviewDraft): ImportPlan {
  const problems = checkDraft(draft)
  if (problems.length > 0) throw new Error(problems.map((p) => p.message).join(" "))

  const course: ImportPlan["course"] =
    draft.target.kind === "existing"
      ? { kind: "existing", courseId: draft.target.courseId }
      : {
          kind: "new",
          input: {
            code: draft.course.code.trim(),
            name: draft.course.name.trim(),
            professor: draft.course.professor.trim(),
            description: draft.course.description.trim(),
          },
        }

  const tasks = draft.items
    .filter((item) => item.selected)
    .map((item) => ({
      title: item.title.trim(),
      description: item.description.trim(),
      type: item.type,
      dueDate: item.dueDate,
      dueTime: item.dueTime || undefined,
      priority: item.priority,
      estimateMinutes: item.estimateMinutes ? Number(item.estimateMinutes) : defaultEstimateMinutes[item.type],
      status: "not_started" as const,
    }))

  return { course, tasks }
}

// Where the import writes to. In the app these are the course and task stores;
// later, the database.
export type ImportServices = {
  addCourse: (input: CourseInput) => { id: string }
  addTask: (input: TaskInput) => void
}

export type ImportResult = { courseId: string; taskCount: number; createdCourse: boolean }

// Imports only when `confirmed` is true; otherwise nothing is created.
export function importReviewedSyllabus(
  draft: ReviewDraft,
  confirmed: boolean,
  services: ImportServices
): ImportResult | null {
  if (!confirmed) return null
  const plan = buildImportPlan(draft)
  const courseId = plan.course.kind === "existing" ? plan.course.courseId : services.addCourse(plan.course.input).id
  for (const task of plan.tasks) services.addTask({ ...task, courseId })
  return { courseId, taskCount: plan.tasks.length, createdCourse: plan.course.kind === "new" }
}
