import "server-only"

import { eq } from "drizzle-orm"
import { toAcademicEvents } from "@/lib/academic-calendar-ai/schema"
import { getAcademicCalendarAI, usesMockAcademicCalendarAI, type AcademicCalendarAI } from "@/lib/ai/academic-calendar-ai"
import { extractPdfText } from "@/lib/syllabus/pdf"
import type { AcademicEventInput, CalendarProposal } from "@/lib/types"
import { schoolCalendars } from "../db/schema"
import type { Database } from "../db/types"
import { logger } from "../log"
import { findSchoolCalendar, pageText } from "./find"
import { safeFetch, type PageFetcher } from "./safe-fetch"

// A school's academic calendar, for a student to review and confirm:
//   - from the school's website (found and read once, then shared by every student
//     of that school for a month; a school not found is tried again after a week)
//   - from a link the student pastes, or a PDF they upload (read for them only)
// Nothing here changes the student's own calendar: they confirm it first
// (replaceAcademicEvents).

export type { CalendarProposal }

type Deps = { today: string; schoolName: string; now?: Date; fetchPage?: PageFetcher; ai?: AcademicCalendarAI }

const DAY_MS = 86_400_000
const FOUND_FOR_DAYS = 30
const NOT_FOUND_FOR_DAYS = 7

export async function calendarFromSchoolWebsite(db: Database, domain: string, deps: Deps): Promise<CalendarProposal> {
  // The fake AI (tests, demos): no website visit, and nothing fake in the shared cache.
  if (!deps.ai && usesMockAcademicCalendarAI()) {
    const raw = await getAcademicCalendarAI().readCalendar(`Mock calendar for ${domain}`, { today: deps.today, schoolName: deps.schoolName })
    return { status: "found", events: toAcademicEvents(raw, deps.today), sources: [`https://www.${domain}/`] }
  }
  const now = deps.now ?? new Date()
  const [cached] = await db.select().from(schoolCalendars).where(eq(schoolCalendars.domain, domain))
  if (cached) {
    const age = (now.getTime() - cached.checkedAt.getTime()) / DAY_MS
    const events = cached.events as AcademicEventInput[]
    // Still fresh, and not all in the past (a new school year means reading it again).
    if (cached.status === "found" && age < FOUND_FOR_DAYS && events.some((event) => event.endDate >= deps.today)) {
      return { status: "found", events, sources: cached.sources }
    }
    if (cached.status === "not_found" && age < NOT_FOUND_FOR_DAYS) return { status: "not_found" }
  }

  const remember = async (row: { status: "found" | "not_found"; events: AcademicEventInput[]; sources: string[] }) => {
    const values = { ...row, checkedAt: now }
    await db.insert(schoolCalendars).values({ domain, ...values }).onConflictDoUpdate({ target: schoolCalendars.domain, set: values })
  }

  const found = await findSchoolCalendar(domain, deps.today, deps.fetchPage ?? safeFetch)
  if (!found) {
    logger.info("academic-calendar", "not found on the school's website", { domain })
    await remember({ status: "not_found", events: [], sources: [] })
    return { status: "not_found" }
  }
  // AI failures throw (and aren't remembered): trying again later may work.
  const raw = await (deps.ai ?? getAcademicCalendarAI()).readCalendar(found.text, { today: deps.today, schoolName: deps.schoolName })
  const events = toAcademicEvents(raw, deps.today)
  if (events.length === 0) {
    logger.info("academic-calendar", "pages found but no usable dates", { domain, sources: found.sources.length })
    await remember({ status: "not_found", events: [], sources: found.sources })
    return { status: "not_found" }
  }
  await remember({ status: "found", events, sources: found.sources })
  return { status: "found", events, sources: found.sources }
}

// A link the student pasted: any public https page (checked like every fetch). Not shared.
export async function calendarFromLink(url: string, deps: Deps): Promise<CalendarProposal> {
  const page = await (deps.fetchPage ?? safeFetch)(url, { maxBytes: 10 * 1024 * 1024 })
  if (!page) return { status: "not_found" }
  const text = await pageText(page).catch(() => "")
  if (!text.trim()) return { status: "not_found" }
  return fromText(`Source: ${page.url}\n\n${text.slice(0, 60_000)}`, [page.url], deps)
}

// A PDF the student uploaded (checked like a syllabus upload). Not shared.
export async function calendarFromPdf(bytes: Uint8Array, deps: Deps): Promise<CalendarProposal> {
  const { text } = await extractPdfText(bytes)
  return fromText(text.slice(0, 60_000), [], deps)
}

async function fromText(text: string, sources: string[], deps: Deps): Promise<CalendarProposal> {
  const raw = await (deps.ai ?? getAcademicCalendarAI()).readCalendar(text, { today: deps.today, schoolName: deps.schoolName })
  const events = toAcademicEvents(raw, deps.today)
  return events.length > 0 ? { status: "found", events, sources } : { status: "not_found" }
}
