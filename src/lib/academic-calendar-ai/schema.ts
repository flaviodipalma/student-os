import { z } from "zod"
import type { AcademicEventInput } from "@/lib/types"
import { academicEventSchema } from "@/lib/validation"

// What the AI must return for a school's academic calendar page(s). The answer is
// untrusted: every item is checked again (toAcademicEvents) before the student sees
// it, and the student confirms everything before it's saved.

export const calendarExtractionSchema = z.object({
  found: z.boolean().describe("True only if the text really is this school's academic calendar with dated items."),
  items: z
    .array(
      z.object({
        term: z.string().describe("The semester or term the item belongs to, e.g. 'Fall 2026', 'Spring 2027', 'January 2027'."),
        kind: z
          .enum(["term", "no_classes", "exams", "deadline", "other"])
          .describe(
            "term: the semester itself (first day of classes to the last day of classes or finals). no_classes: a holiday, break, reading day or any day without classes. exams: the final exam period. deadline: an academic deadline (add/drop, withdraw, pass/fail, grades due). other: anything else worth knowing (orientation, commencement)."
          ),
        title: z.string().describe("Short name as the calendar writes it, e.g. 'Thanksgiving recess' or 'Last day to withdraw'."),
        startDate: z.string().describe("First day, YYYY-MM-DD."),
        endDate: z.string().describe("Last day, YYYY-MM-DD (the same as startDate for a single day)."),
      })
    )
    .describe("The calendar's items for the current and the next semester only."),
})

export type CalendarExtraction = z.infer<typeof calendarExtractionSchema>

// The AI's answer -> the student's academic calendar items: well-formed, not long
// past, no duplicates, at most 150. Returns [] when nothing usable is left.
// Each item is checked on its own: one bad item doesn't cost the good ones.
const answerShape = z.object({ found: z.boolean(), items: z.array(z.unknown()) })
const itemShape = z.object({ term: z.string(), kind: z.string(), title: z.string(), startDate: z.string(), endDate: z.string() })

export function toAcademicEvents(raw: unknown, today: string): AcademicEventInput[] {
  const parsed = answerShape.safeParse(raw)
  if (!parsed.success || !parsed.data.found) return []
  const recent = new Date(Date.parse(`${today}T00:00:00Z`) - 200 * 86_400_000).toISOString().slice(0, 10)
  const seen = new Set<string>()
  const events: AcademicEventInput[] = []
  for (const raw of parsed.data.items) {
    const item = itemShape.safeParse(raw)
    if (!item.success) continue
    const checked = academicEventSchema.safeParse({ ...item.data, title: item.data.title.slice(0, 150), term: item.data.term.slice(0, 60) })
    if (!checked.success || checked.data.endDate < recent) continue
    const key = `${checked.data.kind}|${checked.data.title.toLowerCase()}|${checked.data.startDate}`
    if (seen.has(key)) continue
    seen.add(key)
    events.push(checked.data)
  }
  return events.sort((a, b) => a.startDate.localeCompare(b.startDate)).slice(0, 150)
}
