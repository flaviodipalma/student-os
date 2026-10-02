import "server-only"

import { and, eq, inArray } from "drizzle-orm"
import { toFindings, type FindingInput } from "@/lib/announcements/schema"
import { normalizeExternalEvent, type ExternalCalendarEvent } from "@/lib/calendar/external-events"
import { classifyCalendarItem } from "@/lib/lms/course-calendar"
import type { LmsAnnouncement, LmsCalendarItem } from "@/lib/lms/types"
import type { LmsProviderId } from "@/lib/types"
import { getAnnouncementAI, type AnnouncementAI, type AnnouncementForAI } from "@/lib/ai/announcement-ai"
import { announcementFindings, classCancellations, courses, lmsAnnouncements, tasks } from "../../db/schema"
import type { Database } from "../../db/types"
import { errorName, logger } from "../../log"
import { RATE_LIMITS, takeRateLimit } from "../../rate-limit"
import { syncExternalCalendar } from "../calendar/calendar-sync"
import { utcToLocalDue } from "./normalize"

// What a sync does with the courses' calendars and announcements, after the courses
// and assignments are saved (src/server/integrations/lms/sync.ts). Exams and quizzes
// on the calendar are already tasks by then (calendarItemAsAssignment). Here:
//   calendar "no class" items -> class cancellations (applied right away: they're dated)
//   other calendar items      -> read-only events on the student's calendar
//   new announcements         -> read once by the AI -> suggestions for the Dashboard
// None of it can fail the sync: a problem is logged and the rest carries on. An
// announcement is recorded as read only once the AI has read it, so one that couldn't
// be read (AI down, over the limit) is tried again on the next sync.

export type ExtrasResult = { calendarEventsAdded: number; classesCancelled: number; suggestions: number }

const MAX_ANNOUNCEMENTS_PER_SYNC = 30
const MAX_ANNOUNCEMENT_TEXT = 4000

export async function syncCourseExtras(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  input: {
    // Null: the extension didn't send any (an older version): nothing changes.
    calendar: LmsCalendarItem[] | null
    announcements: LmsAnnouncement[] | null
    timeZone: string | undefined
    now: Date
    ai?: AnnouncementAI
  }
): Promise<ExtrasResult> {
  const result: ExtrasResult = { calendarEventsAdded: 0, classesCancelled: 0, suggestions: 0 }
  // The student's courses from this LMS: external id -> Quadernio course.
  const rows = await db
    .select({ id: courses.id, externalId: courses.externalId, code: courses.courseCode, name: courses.courseName })
    .from(courses)
    .where(and(eq(courses.userId, userId), eq(courses.externalSource, provider)))
  const byExternal = new Map(rows.filter((row) => row.externalId).map((row) => [row.externalId as string, row]))
  const localDate = (iso: string) => utcToLocalDue(iso, input.timeZone)?.dueDate ?? null
  const today = localDate(input.now.toISOString()) ?? input.now.toISOString().slice(0, 10)

  if (input.calendar) {
    try {
      Object.assign(result, await syncCalendar(db, userId, provider, input.calendar, byExternal, localDate, input.now, today))
    } catch (error) {
      logger.error("lms-extras", "calendar failed", { provider, name: errorName(error) })
    }
  }
  if (input.announcements) {
    try {
      result.suggestions = await readAnnouncements(db, userId, provider, input.announcements, byExternal, { ...input, today })
    } catch (error) {
      logger.error("lms-extras", "announcements failed", { provider, name: errorName(error) })
    }
  }
  return result
}

type CourseRow = { id: string; code: string; name: string }

async function syncCalendar(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  items: LmsCalendarItem[],
  byExternal: Map<string, CourseRow>,
  localDate: (iso: string) => string | null,
  now: Date,
  today: string
): Promise<Pick<ExtrasResult, "calendarEventsAdded" | "classesCancelled">> {
  const events: ExternalCalendarEvent[] = []
  const cancellations: { courseId: string; date: string }[] = []
  let skipped = 0
  for (const item of items) {
    const course = byExternal.get(item.courseExternalId)
    if (!course) continue
    const kind = classifyCalendarItem(item.title)
    // Exams and quizzes became tasks with the assignments.
    if (kind === "exam" || kind === "quiz") continue
    if (kind === "no_class") {
      const date = item.allDayDate ?? (item.startsAt ? localDate(item.startsAt) : null)
      if (date && date >= today) cancellations.push({ courseId: course.id, date })
      continue
    }
    const start = item.startsAt ? new Date(item.startsAt) : null
    const normalized = normalizeExternalEvent({
      source: provider,
      externalId: `event:${item.externalId}`,
      title: `${course.code} · ${item.title}`,
      description: item.description,
      start,
      end: item.endsAt ? new Date(item.endsAt) : null,
      allDay: item.allDayDate !== null,
      location: item.location,
      url: item.url,
    })
    if ("event" in normalized) events.push(normalized.event)
    else skipped++
  }
  let classesCancelled = 0
  if (cancellations.length > 0) {
    const inserted = await db
      .insert(classCancellations)
      .values(cancellations.map((cancellation) => ({ userId, ...cancellation, source: "calendar" as const })))
      .onConflictDoNothing()
      .returning({ id: classCancellations.id })
    classesCancelled = inserted.length
  }
  const saved = await syncExternalCalendar(db, userId, provider, events, { now, skipped })
  return { calendarEventsAdded: saved.added, classesCancelled }
}

async function readAnnouncements(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  announcements: LmsAnnouncement[],
  byExternal: Map<string, CourseRow>,
  input: { timeZone: string | undefined; now: Date; today: string; ai?: AnnouncementAI }
): Promise<number> {
  const known = announcements.filter((item) => byExternal.has(item.courseExternalId))
  if (known.length === 0) return 0
  const seen = new Set(
    (
      await db
        .select({ externalId: lmsAnnouncements.externalId })
        .from(lmsAnnouncements)
        .where(
          and(
            eq(lmsAnnouncements.userId, userId),
            eq(lmsAnnouncements.provider, provider),
            inArray(
              lmsAnnouncements.externalId,
              known.map((item) => item.externalId)
            )
          )
        )
    ).map((row) => row.externalId)
  )
  // New ones, newest first; the rest wait for the next sync.
  const fresh = known
    .filter((item) => !seen.has(item.externalId))
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
    .slice(0, MAX_ANNOUNCEMENTS_PER_SYNC)
  if (fresh.length === 0) return 0

  // Short ids for the AI ("a1"…), mapped back afterwards.
  const forAI: AnnouncementForAI[] = []
  const byShortId = new Map<string, LmsAnnouncement>()
  for (const [index, item] of fresh.entries()) {
    if (!item.text.trim() && !item.title.trim()) continue
    const course = byExternal.get(item.courseExternalId) as CourseRow
    const posted = (item.postedAt && utcToLocalDue(item.postedAt, input.timeZone)?.dueDate) || input.today
    const shortId = `a${index + 1}`
    byShortId.set(shortId, item)
    forAI.push({ id: shortId, course: `${course.code} · ${course.name}`, posted: `${weekday(posted)}, ${posted}`, title: item.title, text: item.text.slice(0, MAX_ANNOUNCEMENT_TEXT) })
  }

  let findings: FindingInput[] = []
  if (forAI.length > 0) {
    // Over the limit: try again on a later sync (nothing is recorded as read).
    if (!takeRateLimit(`announcements:${userId}`, RATE_LIMITS.announcements).ok) return 0
    try {
      const raw = await (input.ai ?? getAnnouncementAI()).readAnnouncements(forAI, { today: input.today })
      findings = toFindings(raw, new Set(byShortId.keys()), input.today)
    } catch (error) {
      logger.warn("lms-extras", "announcements not read this time", { provider, reason: error instanceof Error ? error.message : errorName(error) })
      return 0
    }
  }

  return db.transaction(async (tx) => {
    // Recorded as read (ids and titles only), then the suggestions that aren't already known.
    const recorded = await tx
      .insert(lmsAnnouncements)
      .values(
        fresh.map((item) => ({
          userId,
          provider,
          externalId: item.externalId,
          courseId: (byExternal.get(item.courseExternalId) as CourseRow).id,
          title: item.title.slice(0, 300),
          postedAt: item.postedAt && !Number.isNaN(Date.parse(item.postedAt)) ? new Date(item.postedAt) : null,
        }))
      )
      .onConflictDoNothing()
      .returning({ id: lmsAnnouncements.id, externalId: lmsAnnouncements.externalId })
    const rowIdByExternal = new Map(recorded.map((row) => [row.externalId, row.id]))
    let added = 0
    for (const finding of findings) {
      const announcement = byShortId.get(finding.announcementId) as LmsAnnouncement
      const announcementRowId = rowIdByExternal.get(announcement.externalId)
      const courseId = (byExternal.get(announcement.courseExternalId) as CourseRow).id
      if (!announcementRowId || (await alreadyKnown(tx, userId, courseId, finding))) continue
      await tx.insert(announcementFindings).values({
        userId,
        announcementId: announcementRowId,
        courseId,
        kind: finding.kind,
        title: finding.title,
        date: finding.date,
        time: finding.time,
        quote: finding.quote,
      })
      added++
    }
    return added
  })
}

// Already suggested (in any state), already a task of that kind that day, or that
// class already cancelled: no second suggestion.
async function alreadyKnown(db: Database, userId: string, courseId: string, finding: FindingInput): Promise<boolean> {
  const suggested = await db
    .select({ id: announcementFindings.id })
    .from(announcementFindings)
    .where(
      and(
        eq(announcementFindings.userId, userId),
        eq(announcementFindings.courseId, courseId),
        eq(announcementFindings.kind, finding.kind),
        eq(announcementFindings.date, finding.date)
      )
    )
    .limit(1)
  if (suggested.length > 0) return true
  if (finding.kind === "no_class") {
    const cancelled = await db
      .select({ id: classCancellations.id })
      .from(classCancellations)
      .where(and(eq(classCancellations.userId, userId), eq(classCancellations.courseId, courseId), eq(classCancellations.date, finding.date)))
      .limit(1)
    return cancelled.length > 0
  }
  const types = finding.kind === "deadline" ? null : [finding.kind]
  const sameDay = await db
    .select({ type: tasks.type, title: tasks.title })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.courseId, courseId), eq(tasks.dueDate, finding.date)))
  return sameDay.some((task) => (types ? types.includes(task.type as "exam" | "quiz") : sameWords(task.title, finding.title)))
}

// "Essay draft due" and "Essay draft" are the same thing.
function sameWords(a: string, b: string): boolean {
  const words = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length > 2 && word !== "due"))
  const [x, y] = [words(a), words(b)]
  if (x.size === 0 || y.size === 0) return false
  const shared = [...x].filter((word) => y.has(word)).length
  return shared / Math.min(x.size, y.size) >= 0.6
}

const weekday = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })
