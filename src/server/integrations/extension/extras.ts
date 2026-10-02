import "server-only"

import { z } from "zod"
import { calendarItemAsAssignment, classifyCalendarItem } from "@/lib/lms/course-calendar"
import type { LmsAnnouncement, LmsAssignment, LmsCalendarItem, LmsSyncResult } from "@/lib/lms/types"
import type { LmsProviderId } from "@/lib/types"
import type { Database } from "../../db/types"
import { syncCourseExtras } from "../lms/course-extras"
import { utcToLocalDue } from "../lms/normalize"

// The courses' calendar items and recent announcements in an extension import (the
// same for Canvas, Blackboard and Brightspace D2L; each maps its own raw shape):
//   "events":        { "<course id>": [...calendar items] }
//   "announcements": { "<course id>": [...announcements from the last 3 weeks] }
// Both optional: an older extension sends neither, and nothing about them changes.

export const MAX_EVENTS_PER_COURSE = 200
export const MAX_ANNOUNCEMENTS_PER_COURSE = 20

export const extrasFields = {
  events: z.record(z.string().max(40), z.array(z.unknown()).max(MAX_EVENTS_PER_COURSE)).optional(),
  announcements: z.record(z.string().max(40), z.array(z.unknown()).max(MAX_ANNOUNCEMENTS_PER_COURSE)).optional(),
}

export type CourseExtras = {
  calendar: LmsCalendarItem[] | null
  announcements: LmsAnnouncement[] | null
}

// Own properties only: an id like "__proto__" or "constructor" isn't a list.
const entries = (record: Record<string, unknown[]> | undefined) =>
  record ? Object.keys(record).filter((key) => Object.hasOwn(record, key)).map((key) => [key, record[key]] as const) : null

export function readExtras(
  data: { events?: Record<string, unknown[]>; announcements?: Record<string, unknown[]> },
  mapItem: (raw: unknown, courseId: string) => LmsCalendarItem | null,
  mapAnnouncement: (raw: unknown, courseId: string) => LmsAnnouncement | null
): CourseExtras {
  const events = entries(data.events)
  const announcements = entries(data.announcements)
  return {
    calendar: events && events.flatMap(([courseId, list]) => list.map((raw) => mapItem(raw, courseId)).filter((item): item is LmsCalendarItem => item !== null)),
    announcements:
      announcements &&
      announcements.flatMap(([courseId, list]) => list.map((raw) => mapAnnouncement(raw, courseId)).filter((item): item is LmsAnnouncement => item !== null)),
  }
}

// A course's exams and quizzes on its calendar, as assignments for the normal sync.
export function calendarExams(extras: CourseExtras, courseId: string, timeZone: string | undefined): LmsAssignment[] {
  return (extras.calendar ?? []).flatMap((item) => {
    if (item.courseExternalId !== courseId) return []
    const kind = classifyCalendarItem(item.title)
    if (kind !== "exam" && kind !== "quiz") return []
    const assignment = calendarItemAsAssignment(item, kind, (iso) => utcToLocalDue(iso, timeZone))
    return assignment ? [assignment] : []
  })
}

// After the sync: calendar events, cancelled classes and suggestions, added to its summary.
export async function withCourseExtras(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  result: LmsSyncResult,
  extras: CourseExtras,
  options: { timeZone: string | undefined; now: Date }
): Promise<LmsSyncResult> {
  if (!extras.calendar && !extras.announcements) return result
  const added = await syncCourseExtras(db, userId, provider, { ...extras, ...options })
  return { ...result, ...added }
}
