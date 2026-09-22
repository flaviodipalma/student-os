import type { SyllabusExtraction, SyllabusItemType } from "@/lib/syllabus/schema"
import type { SyllabusAIContext, SyllabusAIService } from "./syllabus-ai-service"

// NOT AI. A tiny pattern matcher for local development and demos without an API
// key, enabled only with SYLLABUS_AI_PROVIDER=mock. It recognizes lines like
// "Assignment 1 — September 25" and a course code like "CSC 215". Real syllabi
// need the real provider.

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DATED_LINE =
  /^(.{3,80}?)\s*(?:[—–:-]|\bdue\b)\s*(?:[a-z]{3,9},?\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sept?|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?/i

function typeOf(title: string): SyllabusItemType {
  const t = title.toLowerCase()
  if (/midterm|final|exam/.test(t)) return "exam"
  if (/quiz/.test(t)) return "quiz"
  if (/project|milestone/.test(t)) return "project"
  if (/paper|essay/.test(t)) return "paper"
  if (/reading|chapter/.test(t)) return "reading"
  if (/lab/.test(t)) return "lab"
  if (/presentation/.test(t)) return "presentation"
  if (/assignment|homework|problem set|hw/.test(t)) return "assignment"
  return "other"
}

export class MockSyllabusService implements SyllabusAIService {
  async extractSyllabusData(text: string, context: SyllabusAIContext): Promise<SyllabusExtraction> {
    const lines = text.split("\n").map((line) => line.trim())
    const code = text.match(/\b([A-Z]{2,4})\s?-?(\d{3}[A-Z]?)\b/)
    const termYear = text.match(/\b(?:fall|spring|summer|winter)\s+(\d{4})\b/i)?.[1]
    const year = termYear ?? context.today.slice(0, 4)
    const professor = text.match(/(?:instructor|professor)\s*:\s*(.+)/i)?.[1]?.trim() ?? null
    const name = code ? (lines.find((line) => line.includes(code[0]))?.replace(code[0], "").replace(/^[\s—–:-]+/, "") || null) : null

    const items = lines.flatMap((line) => {
      const match = line.match(DATED_LINE)
      if (!match) return []
      const [, title, month, day, explicitYear] = match
      const monthIndex = MONTHS.indexOf(month.toLowerCase().slice(0, 3))
      const dueDate = `${explicitYear ?? year}-${String(monthIndex + 1).padStart(2, "0")}-${day.padStart(2, "0")}`
      return [
        {
          title: title.trim(),
          type: typeOf(title),
          dueDate,
          dueTime: null,
          dateText: line.slice(title.length).replace(/^[\s—–:-]+/, ""),
          description: null,
          estimatedMinutes: null,
          priority: null,
          needsReview: !explicitYear && !termYear,
          reviewReason: !explicitYear && !termYear ? "Year not stated in the syllabus" : null,
        },
      ]
    })

    return {
      course: {
        courseCode: code ? `${code[1]}${code[2]}` : null,
        courseName: name,
        professor,
        description: null,
        term: termYear ? text.match(/\b(?:fall|spring|summer|winter)\s+\d{4}\b/i)?.[0] ?? null : null,
      },
      items,
      warnings: ["Mock extraction for local testing. Connect a real AI provider for real syllabi."],
    }
  }
}
