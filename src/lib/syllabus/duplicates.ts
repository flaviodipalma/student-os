import type { Course, Task } from "@/lib/types"

// Simple duplicate detection, so importing the same syllabus twice doesn't create
// everything twice. A likely duplicate = same course + similar title + same due date.

// "CSC 215", "csc-215" and "CSC215" are the same course code.
export function normalizeCourseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

// Lowercase words and numbers only: "Assignment #2: Linked Lists" -> ["assignment", "2", "linked", "lists"]
function titleWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/\bno\.\s*(?=\d)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

// Titles match if they have the same words, or one's words are all in the other
// ("Assignment 2" vs "Assignment #2: Linked Lists"). Numbers must match exactly,
// so "Quiz 1" and "Quiz 10" stay different.
export function titlesSimilar(a: string, b: string): boolean {
  const wordsA = new Set(titleWords(a))
  const wordsB = new Set(titleWords(b))
  if (wordsA.size === 0 || wordsB.size === 0) return false
  const [small, large] = wordsA.size <= wordsB.size ? [wordsA, wordsB] : [wordsB, wordsA]
  return [...small].every((word) => large.has(word))
}

export function findMatchingCourse(code: string | null, courses: Course[]): Course | undefined {
  if (!code) return undefined
  const wanted = normalizeCourseCode(code)
  return wanted ? courses.find((course) => normalizeCourseCode(course.code) === wanted) : undefined
}

export function findDuplicateTask(
  item: { title: string; dueDate: string },
  courseId: string,
  tasks: Task[]
): Task | undefined {
  if (!item.dueDate || !item.title.trim()) return undefined
  return tasks.find(
    (task) => task.courseId === courseId && task.dueDate === item.dueDate && titlesSimilar(task.title, item.title)
  )
}
