import { z } from "zod"
import { addDays } from "@/lib/format"
import type { AnnouncementFindingKind } from "@/lib/types"

// What the AI must return for a batch of course announcements. The answer is
// untrusted: every finding is checked again (toFindings) and the student accepts
// each one before anything in their plan changes.

export const announcementExtractionSchema = z.object({
  findings: z
    .array(
      z.object({
        announcementId: z.string().describe("The id of the announcement it comes from, exactly as given."),
        kind: z
          .enum(["exam", "quiz", "deadline", "no_class"])
          .describe(
            "exam: an exam, midterm, final or test. quiz: a quiz. deadline: something due (an essay, a project, a problem set) with its due date. no_class: the class does not meet that day (cancelled, the professor is away, moved online is NOT no_class)."
          ),
        title: z.string().describe("Short title for the student's planner, e.g. 'Quiz 3', 'Midterm exam', 'Essay draft due', 'No class'."),
        date: z.string().describe("The day it happens or is due, YYYY-MM-DD."),
        time: z.string().nullable().describe("The time as HH:MM (24-hour) if the announcement states one, otherwise null."),
        quote: z.string().describe("The sentence from the announcement this comes from, word for word."),
      })
    )
    .describe("Only things that are stated clearly, about this course, on a specific day that hasn't passed."),
})

export type AnnouncementExtraction = z.infer<typeof announcementExtractionSchema>

export type FindingInput = {
  announcementId: string
  kind: AnnouncementFindingKind
  title: string
  date: string
  time: string | null
  quote: string | null
}

const answerShape = z.object({ findings: z.array(z.unknown()) })
const itemShape = z.object({
  announcementId: z.string(),
  kind: z.enum(["exam", "quiz", "deadline", "no_class"]),
  title: z.string(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().nullable().optional(),
  quote: z.string().nullable().optional(),
})
const validDay = (day: string) => {
  const parsed = new Date(`${day}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day
}

// The AI's answer -> findings: about a given announcement, a real day from today up
// to half a year ahead, a valid time or none, short texts, no duplicates.
// Each one is checked on its own: one bad finding doesn't cost the good ones.
export function toFindings(raw: unknown, announcementIds: Set<string>, today: string): FindingInput[] {
  const parsed = answerShape.safeParse(raw)
  if (!parsed.success) return []
  const latest = addDays(today, 183)
  const seen = new Set<string>()
  const findings: FindingInput[] = []
  for (const candidate of parsed.data.findings) {
    const item = itemShape.safeParse(candidate)
    if (!item.success || !announcementIds.has(item.data.announcementId)) continue
    const { date } = item.data
    if (!validDay(date) || date < today || date > latest) continue
    const time = item.data.time && /^([01]\d|2[0-3]):[0-5]\d$/.test(item.data.time) ? item.data.time : null
    const title = item.data.title.replace(/\s+/g, " ").trim().slice(0, 120)
    if (!title) continue
    const key = `${item.data.announcementId}|${item.data.kind}|${date}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push({
      announcementId: item.data.announcementId,
      kind: item.data.kind,
      title,
      date,
      time,
      quote: item.data.quote?.replace(/\s+/g, " ").trim().slice(0, 300) || null,
    })
  }
  return findings.slice(0, 40)
}
