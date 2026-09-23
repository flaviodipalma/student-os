import "server-only"

import type { LmsAssignment, LmsCourse } from "@/lib/lms/types"
import { LmsError } from "../provider"
import { parseCanvasBaseUrl } from "./config"
import { looksLikeIcs, parseIcs, type IcsEvent } from "./ical"
import { canvasDueToLocal, safeCanvasUrl } from "./mapping"
import type { Fetch } from "./oauth"

// Reading a student's Canvas CALENDAR FEED (Canvas > Calendar > Calendar Feed):
// a private iCalendar link Canvas gives every student, no developer key needed.
//
// What Canvas puts in it (from Canvas's own calendar-feed code):
//   UID      "event-assignment-<assignment id>" for assignments
//            ("event-calendar-event-<id>" for calendar events, which aren't imported)
//   SUMMARY  "<title> [<course code>]"
//   DTSTART  the due time in UTC, or a date for all-day items; undated items are left out
//   URL      a Canvas calendar link with include_contexts=course_<course id>
// So feed imports use the SAME Canvas course and assignment ids as the API: a
// student who later connects with OAuth keeps their imported tasks, no duplicates.
//
// The link works like a password (anyone with it can read the calendar): it's
// stored encrypted, only fetched by the server, never shown again or logged.

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15_000
const FEED_PATH = /^\/feeds\/calendars\/[A-Za-z0-9_.-]+\.ics$/

// The feed link -> { baseUrl, feedUrl }. Only Canvas feed links on an allowed
// Canvas host, over HTTPS (so the field can't make the server fetch anything else).
export function parseCanvasFeedUrl(input: string, allowedHosts: string[]): { baseUrl: string; feedUrl: string } {
  const invalid = new LmsError(
    "Paste the Calendar Feed link from Canvas (Calendar > Calendar Feed). It looks like https://school.instructure.com/feeds/calendars/user_….ics"
  )
  const raw = input.trim().replace(/^webcals?:\/\//i, "https://")
  if (!raw || raw.length > 2000) throw invalid
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw invalid
  }
  if (!FEED_PATH.test(url.pathname) || url.hash) throw invalid
  const baseUrl = parseCanvasBaseUrl(url.origin, allowedHosts)
  return { baseUrl, feedUrl: `${baseUrl}${url.pathname}${url.search}` }
}

// Downloads the feed (size- and time-limited; redirects aren't followed).
export async function fetchCanvasFeed(feedUrl: string, fetchImpl: Fetch = fetch): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(feedUrl, {
      headers: { Accept: "text/calendar" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new LmsError("Canvas is temporarily unavailable. Please try again.")
  }
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    throw new LmsError("This Canvas calendar feed link no longer works. Paste a new one from Canvas.", "connection", true)
  }
  if (!response.ok) throw new LmsError("Canvas is temporarily unavailable. Please try again.")

  // Read at most MAX_BYTES.
  const reader = response.body?.getReader()
  if (!reader) throw new LmsError("Canvas sent a calendar Student OS couldn't read.")
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new LmsError("This Canvas calendar is too large to import.")
    }
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks))
  if (!looksLikeIcs(text)) throw new LmsError("That link didn't return a Canvas calendar. Check that you copied the Calendar Feed link.")
  return text
}

const ASSIGNMENT_UID = /^event-(assignment|sub-assignment)-(\d+)$/
const TITLE_WITH_CODE = /^(.*?)\s*\[([^\]]+)\]\s*$/

// The Canvas course id in a feed event's calendar link (include_contexts=course_<id>).
function courseIdFrom(url: string | null): string | null {
  if (!url) return null
  try {
    const contexts = new URL(url).searchParams.get("include_contexts") ?? ""
    return contexts.match(/(?:^|,)course_(\d+)(?:,|$)/)?.[1] ?? null
  } catch {
    return null
  }
}

export type CanvasFeedData = { courses: LmsCourse[]; assignments: LmsAssignment[]; skippedEvents: number }

// Feed events -> normalized courses and assignments. Only assignments with a due
// date and a known course are included; nothing is guessed.
export function canvasFeedToLms(text: string, context: { baseUrl: string; timeZone: string | undefined }): CanvasFeedData {
  const courses = new Map<string, LmsCourse>()
  const assignments: LmsAssignment[] = []
  let skippedEvents = 0

  for (const event of parseIcs(text)) {
    const assignment = assignmentFrom(event, context)
    if (!assignment) {
      skippedEvents++
      continue
    }
    assignments.push(assignment.assignment)
    if (!courses.has(assignment.course.externalId)) courses.set(assignment.course.externalId, assignment.course)
  }
  return { courses: [...courses.values()], assignments, skippedEvents }
}

function assignmentFrom(
  event: IcsEvent,
  context: { baseUrl: string; timeZone: string | undefined }
): { assignment: LmsAssignment; course: LmsCourse } | null {
  const uid = event.uid?.match(ASSIGNMENT_UID)
  if (!uid || !event.summary || !event.start) return null
  const titled = event.summary.match(TITLE_WITH_CODE)
  const title = (titled ? titled[1] : event.summary).trim()
  const courseCode = titled?.[2].trim() ?? null
  const courseId = courseIdFrom(event.url)
  if (!title || !courseId || !courseCode) return null

  const due =
    event.start.kind === "date"
      ? { dueDate: event.start.date, dueTime: null }
      : canvasDueToLocal(event.start.instant.toISOString(), context.timeZone)
  if (!due) return null

  return {
    course: {
      provider: "canvas",
      externalId: courseId,
      // The feed only has the course code; the student can rename the course in Student OS.
      courseCode,
      courseName: courseCode,
      description: null,
      instructor: null,
      url: null,
    },
    assignment: {
      provider: "canvas",
      // Same id space as the Canvas API ("sub-assignment" = discussion checkpoints).
      externalId: uid[1] === "assignment" ? uid[2] : `sub-assignment-${uid[2]}`,
      courseExternalId: courseId,
      title,
      description: event.description?.trim() || null,
      dueDate: due.dueDate,
      dueTime: due.dueTime,
      type: "assignment",
      // Canvas's own link (it opens the assignment on the Canvas calendar).
      url: safeCanvasUrl(event.url, context.baseUrl),
      estimatedMinutes: null,
      submissionStatus: "unknown",
    },
  }
}
