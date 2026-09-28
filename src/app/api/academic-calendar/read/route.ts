import { CalendarReadError } from "@/lib/ai/academic-calendar-ai"
import { daysBetween, fromDateKey, toDateKey } from "@/lib/format"
import { SyllabusImportError } from "@/lib/syllabus/errors"
import { checkUpload, MAX_FILE_BYTES } from "@/lib/syllabus/pdf"
import type { ReadCalendarResponse } from "@/lib/types"
import { calendarFromLink, calendarFromPdf, calendarFromSchoolWebsite } from "@/server/academic-calendar"
import { FetchRefused } from "@/server/academic-calendar/safe-fetch"
import { getCurrentUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { logger } from "@/server/log"
import { RATE_LIMITS, takeRateLimit } from "@/server/rate-limit"
import { readLimited } from "@/server/read-limited"
import { getProfile } from "@/server/services/profiles"

// POST /api/academic-calendar/read (multipart form)
//   mode=school           the student's school's website (found and read once per school)
//   mode=link, url=...     a page or PDF link the student pasted
//   mode=pdf,  file=...    a PDF the student uploaded
//   today=YYYY-MM-DD       the student's date
// Answers { ok: true, proposal } for the student to review, or { ok: false, message }.
// Nothing is saved to the student's calendar here: they confirm it first.

export const maxDuration = 300

const FORM_OVERHEAD_BYTES = 64 * 1024

const reply = (body: ReadCalendarResponse, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
const refuse = (message: string, status: number) => reply({ ok: false, message }, status)

// The student's "today", if within two days of the server's (time zones); else the server's.
function studentToday(value: FormDataEntryValue | null): string {
  const serverToday = toDateKey(new Date())
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return serverToday
  return Math.abs(daysBetween(fromDateKey(serverToday), fromDateKey(value))) <= 2 ? value : serverToday
}

function messageFor(error: unknown): string {
  if (error instanceof FetchRefused) return error.message
  if (error instanceof CalendarReadError) {
    if (error.reason === "not-configured") return "Reading academic calendars isn't set up on this server yet."
    if (error.reason === "busy") return "Student OS is busy right now. Try again in a minute."
    return "We couldn't read that calendar. Try again, or add the dates by hand."
  }
  if (error instanceof SyllabusImportError) {
    if (error.code === "file-too-large") return "That PDF is too large (10 MB at most)."
    if (error.code === "invalid-file-type" || error.code === "empty-file") return "That isn't a PDF file."
    if (error.code === "no-text") return "That PDF has no readable text (it may be a scan)."
    return "We couldn't read that PDF."
  }
  return "Something went wrong reading the calendar. Try again."
}

export async function POST(request: Request) {
  const user = await getCurrentUser()
  if (!user) return refuse("Log in to Student OS first.", 401)
  // Reading a calendar can mean an AI request.
  if (!takeRateLimit(`academic-calendar:${user.id}`, RATE_LIMITS.academicCalendar).ok) {
    return refuse("You've looked for calendars a lot in the last hour. Try again later.", 429)
  }

  const limit = MAX_FILE_BYTES + FORM_OVERHEAD_BYTES
  if (Number(request.headers.get("content-length") ?? 0) > limit) return refuse("That PDF is too large (10 MB at most).", 413)
  const body = await readLimited(request, limit)
  if (body === "too-large") return refuse("That PDF is too large (10 MB at most).", 413)
  let form: FormData
  try {
    form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData()
  } catch {
    return refuse("That request wasn't understood.", 400)
  }

  const db = getDb()
  const profile = await getProfile(db, user.id)
  const deps = { today: studentToday(form.get("today")), schoolName: profile.schoolName || "the student's school" }
  const mode = form.get("mode")
  try {
    if (mode === "school") {
      if (!profile.schoolDomain) return refuse("Add your school's website in Settings > Profile first.", 400)
      return reply({ ok: true, proposal: await calendarFromSchoolWebsite(db, profile.schoolDomain, deps) })
    }
    if (mode === "link") {
      const url = form.get("url")
      if (typeof url !== "string" || url.length > 2000) return refuse("Paste a link that starts with https://.", 400)
      return reply({ ok: true, proposal: await calendarFromLink(url.trim(), deps) })
    }
    if (mode === "pdf") {
      const file = form.get("file")
      if (!(file instanceof File)) return refuse("Choose a PDF file.", 400)
      const bytes = new Uint8Array(await file.arrayBuffer())
      checkUpload({ name: file.name, type: file.type, size: file.size, bytes })
      return reply({ ok: true, proposal: await calendarFromPdf(bytes, deps) })
    }
    return refuse("That request wasn't understood.", 400)
  } catch (error) {
    // The kind of error only (never page contents or links).
    logger.warn("academic-calendar", "read failed", { mode: String(mode), error: error instanceof Error ? error.constructor.name : "unknown" })
    return refuse(messageFor(error), error instanceof FetchRefused ? 400 : 502)
  }
}
