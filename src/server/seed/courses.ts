import type { Course } from "@/lib/types"

// DEVELOPMENT SEED DATA. Only `npm run db:seed` uses this, for a dev test account.
// Real students start with no courses.
export const seedCourses: Course[] = [
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
