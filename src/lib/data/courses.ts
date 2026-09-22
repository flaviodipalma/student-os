import type { Course, CourseColor } from "@/lib/types"

// The student's starting courses (mock data). The live list lives in the course
// store (src/lib/course-store.tsx), which can also add courses, e.g. from a syllabus.
export const mockCourses: Course[] = [
  {
    id: "csc215",
    code: "CSC215",
    name: "Data Structures",
    professor: "Prof. Elena Marsh",
    description:
      "Arrays, linked lists, stacks, queues, trees and hash tables, with a focus on choosing the right structure and analyzing its cost.",
    color: "sky",
  },
  {
    id: "ser225",
    code: "SER225",
    name: "Software Engineering",
    professor: "Dr. Raymond Okafor",
    description:
      "How software gets built by teams: requirements, design, version control, testing, and a semester-long group project.",
    color: "emerald",
  },
  {
    id: "psy101",
    code: "PSY101",
    name: "Introduction to Psychology",
    professor: "Dr. Priya Natarajan",
    description:
      "A survey of how people think, feel and behave, from the brain and perception to memory, development and social behavior.",
    color: "violet",
  },
  {
    id: "bio101",
    code: "BIO101",
    name: "Biology",
    professor: "Prof. Daniel Kim",
    description:
      "Cells, genetics, evolution and ecosystems, with a weekly lab section and written lab reports.",
    color: "orange",
  },
]

// Course colors in the order they're handed out. Checked to stay distinguishable,
// including for color-blind students; the course code is always shown next to it too.
export const courseColors: CourseColor[] = ["sky", "emerald", "violet", "orange", "rose"]

// The first color no course uses yet, or the least-used one once all are taken.
export function pickCourseColor(existing: Course[]): CourseColor {
  const uses = (color: CourseColor) => existing.filter((course) => course.color === color).length
  return [...courseColors].sort((a, b) => uses(a) - uses(b))[0]
}
