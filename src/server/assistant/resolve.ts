import "server-only"

import type { Course, Task } from "@/lib/types"

// Finds the task or course the student means from what the model passed: an id,
// or words from its name ("my database project", "CSC 215"). More than one
// possible match is reported as ambiguous and nothing is changed: the Assistant
// has to ask which one.

export type Resolved<T> = { found: T } | { ambiguous: T[] } | { notFound: true }

const MAX_OPTIONS = 6
// Words that don't help pick a task ("move my project" -> "project").
const FILLER = new Set(["my", "the", "a", "an", "for", "of", "on", "to", "task", "assignment", "session", "study", "that", "this"])

const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()

function words(text: string): string[] {
  const all = normalize(text).split(" ").filter(Boolean)
  const useful = all.filter((word) => !FILLER.has(word))
  return useful.length > 0 ? useful : all
}

function pick<T>(items: T[], ref: string, id: (item: T) => string, names: (item: T) => string[]): Resolved<T> {
  const trimmed = ref.trim()
  if (!trimmed) return { notFound: true }
  const byId = items.find((item) => id(item) === trimmed)
  if (byId) return { found: byId }

  const wanted = normalize(trimmed)
  const exact = items.filter((item) => names(item).some((name) => normalize(name) === wanted))
  if (exact.length === 1) return { found: exact[0] }
  if (exact.length > 1) return { ambiguous: exact.slice(0, MAX_OPTIONS) }

  const needed = words(trimmed)
  const matches = items.filter((item) =>
    names(item).some((name) => {
      const have = new Set(normalize(name).split(" "))
      const joined = normalize(name).replaceAll(" ", "")
      return needed.every((word) => have.has(word) || joined.includes(word))
    })
  )
  if (matches.length === 1) return { found: matches[0] }
  if (matches.length > 1) return { ambiguous: matches.slice(0, MAX_OPTIONS) }
  return { notFound: true }
}

// Open tasks are preferred: "my reading" means the one still to do. A completed
// task is only found when no open task matches.
export function resolveTask(tasks: Task[], ref: string, options: { includeCompleted?: boolean } = {}): Resolved<Task> {
  const open = tasks.filter((task) => task.status !== "completed")
  const result = pick(open, ref, (task) => task.id, (task) => [task.title])
  if (!("notFound" in result) || !options.includeCompleted) return result
  return pick(tasks, ref, (task) => task.id, (task) => [task.title])
}

// A course by id, code ("CSC 215" = "csc215") or name.
export function resolveCourse(courses: Course[], ref: string): Resolved<Course> {
  return pick(courses, ref, (course) => course.id, (course) => [course.code, course.name, `${course.code} ${course.name}`])
}
