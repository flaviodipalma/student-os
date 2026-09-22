import { z } from "zod"

// What the AI must return for a syllabus. The AI response is checked against this
// schema; anything that doesn't match is rejected (see validate.ts).
//
// Unknown information is null, never a guess. Dates are "YYYY-MM-DD", times "HH:MM".

export const syllabusItemTypes = [
  "assignment",
  "exam",
  "quiz",
  "project",
  "paper",
  "reading",
  "lab",
  "presentation",
  "other",
] as const

export type SyllabusItemType = (typeof syllabusItemTypes)[number]

export const syllabusPriorities = ["low", "medium", "high", "critical"] as const

export const syllabusCourseSchema = z.object({
  courseCode: z.string().nullable().describe("Course code exactly as written, e.g. 'CSC 215'. Null if not stated."),
  courseName: z.string().nullable().describe("Course title, e.g. 'Data Structures'. Null if not stated."),
  professor: z.string().nullable().describe("Instructor name exactly as written. Null if not stated; never guess."),
  description: z
    .string()
    .nullable()
    .describe("One or two sentences describing the course, from the syllabus. Null if there is none."),
  term: z.string().nullable().describe("Term or semester, e.g. 'Fall 2026'. Null if not stated."),
})

export const syllabusItemSchema = z.object({
  title: z.string().describe("Short name as the syllabus writes it, e.g. 'Assignment 1' or 'Midterm Exam'."),
  type: z.enum(syllabusItemTypes),
  dueDate: z
    .string()
    .nullable()
    .describe("Due or exam date as YYYY-MM-DD. Null if the syllabus gives no specific date."),
  dueTime: z.string().nullable().describe("Due time as 24-hour HH:MM if stated, otherwise null."),
  dateText: z
    .string()
    .nullable()
    .describe("The date exactly as written in the syllabus, e.g. 'Sept 25' or 'Week 6, Thursday'."),
  description: z.string().nullable().describe("Brief details from the syllabus (topics, format, weight). Null if none."),
  estimatedMinutes: z
    .number()
    .int()
    .nullable()
    .describe("Time the work takes in minutes, ONLY if the syllabus states it. Otherwise null."),
  priority: z
    .enum(syllabusPriorities)
    .nullable()
    .describe("Only if stated or clearly implied by grade weight (e.g. a final exam worth 30%). Otherwise null."),
  needsReview: z.boolean().describe("True if anything about this item is uncertain, e.g. the year was inferred."),
  reviewReason: z.string().nullable().describe("Short reason the student should double-check this item."),
})

export const syllabusExtractionSchema = z.object({
  course: syllabusCourseSchema,
  items: z.array(syllabusItemSchema),
  warnings: z
    .array(z.string())
    .describe("Anything the student should know, e.g. 'Reading due dates are listed by week only'."),
})

export type SyllabusCourse = z.infer<typeof syllabusCourseSchema>
export type SyllabusItem = z.infer<typeof syllabusItemSchema>
export type SyllabusExtraction = z.infer<typeof syllabusExtractionSchema>
