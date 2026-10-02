import "server-only"

import { z } from "zod"
import type { LmsAnnouncement, LmsCalendarItem } from "@/lib/lms/types"
import { sameOriginUrl } from "./base-url"
import { htmlToText } from "./normalize"

// Course calendar items and announcements from each LMS (as the browser extension
// sends them) -> the normalized LmsCalendarItem / LmsAnnouncement. Only the fields
// Quadernio uses are read, each one checked; anything malformed is left out.
//
//   Canvas       GET /api/v1/calendar_events?type=event        GET /api/v1/announcements
//   Blackboard   GET v1/calendars/items (type "Course")         GET v1/courses/{id}/announcements
//   Brightspace  GET le/{v}/{ou}/calendar/events/               GET le/{v}/{ou}/news/

const text = z.string().nullish()
const anyId = z.union([z.number().int().nonnegative(), z.string().min(1).max(80)]).transform(String)
const MAX_TEXT = 4000

const day = (value: string | null | undefined) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)
const plain = (html: string | null | undefined) => (html ? htmlToText(html).slice(0, MAX_TEXT) : "")
const title = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim().slice(0, 200) || null

// ---- Canvas -----------------------------------------------------------------------

const canvasEvent = z.object({
  id: anyId,
  title: text,
  description: text,
  start_at: text,
  end_at: text,
  all_day: z.boolean().nullish(),
  all_day_date: text,
  location_name: text,
  html_url: text,
  workflow_state: text,
})
const canvasAnnouncement = z.object({ id: anyId, title: text, message: text, posted_at: text })

export function canvasCalendarItem(raw: unknown, courseExternalId: string, baseUrl: string): LmsCalendarItem | null {
  const parsed = canvasEvent.safeParse(raw)
  if (!parsed.success || parsed.data.workflow_state === "deleted") return null
  const event = parsed.data
  const name = title(event.title)
  if (!name) return null
  return {
    provider: "canvas",
    externalId: event.id,
    courseExternalId,
    title: name,
    description: plain(event.description) || null,
    startsAt: event.start_at ?? null,
    endsAt: event.end_at ?? null,
    allDayDate: event.all_day ? day(event.all_day_date ?? event.start_at) : null,
    location: event.location_name?.trim() || null,
    url: sameOriginUrl(event.html_url, baseUrl),
  }
}

export function canvasAnnouncementItem(raw: unknown, courseExternalId: string): LmsAnnouncement | null {
  const parsed = canvasAnnouncement.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  return { provider: "canvas", externalId: item.id, courseExternalId, title: title(item.title) ?? "", text: plain(item.message), postedAt: item.posted_at ?? null }
}

// ---- Blackboard Learn -------------------------------------------------------------------

const blackboardItem = z.object({ id: anyId, type: text, title: text, description: text, start: text, end: text, location: text })
const blackboardAnnouncement = z.object({ id: anyId, title: text, body: text, created: text })

export function blackboardCalendarItem(raw: unknown, courseExternalId: string): LmsCalendarItem | null {
  const parsed = blackboardItem.safeParse(raw)
  // Gradebook items (due dates) come with the assignments; only the course's own items here.
  if (!parsed.success || (parsed.data.type && parsed.data.type !== "Course")) return null
  const item = parsed.data
  const name = title(item.title)
  if (!name) return null
  return {
    provider: "blackboard",
    externalId: item.id,
    courseExternalId,
    title: name,
    description: plain(item.description) || null,
    startsAt: item.start ?? null,
    endsAt: item.end ?? null,
    allDayDate: null,
    location: item.location?.trim() || null,
    url: null,
  }
}

export function blackboardAnnouncementItem(raw: unknown, courseExternalId: string): LmsAnnouncement | null {
  const parsed = blackboardAnnouncement.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  return { provider: "blackboard", externalId: item.id, courseExternalId, title: title(item.title) ?? "", text: plain(item.body), postedAt: item.created ?? null }
}

// ---- D2L Brightspace -------------------------------------------------------------------

const brightspaceEvent = z.object({
  CalendarEventId: anyId,
  Title: text,
  Description: text,
  StartDateTime: text,
  EndDateTime: text,
  StartDay: text,
  IsAllDayEvent: z.boolean().nullish(),
  LocationName: text,
  AssociatedEntityType: text,
})
const brightspaceNews = z.object({
  Id: anyId,
  Title: text,
  Body: z.object({ Text: text, Html: text }).partial().nullish(),
  StartDate: text,
  CreatedDate: text,
})

export function brightspaceCalendarItem(raw: unknown, orgUnitId: string, baseUrl: string): LmsCalendarItem | null {
  const parsed = brightspaceEvent.safeParse(raw)
  // An event tied to an assignment folder or quiz is its due date: read with the assignments.
  if (!parsed.success || parsed.data.AssociatedEntityType) return null
  const event = parsed.data
  const name = title(event.Title)
  if (!name) return null
  return {
    provider: "brightspace",
    externalId: event.CalendarEventId,
    courseExternalId: orgUnitId,
    title: name,
    description: plain(event.Description) || null,
    startsAt: event.StartDateTime ?? null,
    endsAt: event.EndDateTime ?? null,
    allDayDate: event.IsAllDayEvent ? day(event.StartDay ?? event.StartDateTime) : null,
    location: event.LocationName?.trim() || null,
    url: `${baseUrl}/d2l/le/calendar/${orgUnitId}`,
  }
}

export function brightspaceAnnouncementItem(raw: unknown, orgUnitId: string): LmsAnnouncement | null {
  const parsed = brightspaceNews.safeParse(raw)
  if (!parsed.success) return null
  const item = parsed.data
  const body = item.Body?.Text?.trim() ? item.Body.Text.slice(0, MAX_TEXT) : plain(item.Body?.Html)
  return {
    provider: "brightspace",
    externalId: item.Id,
    courseExternalId: orgUnitId,
    title: title(item.Title) ?? "",
    text: body,
    postedAt: item.StartDate ?? item.CreatedDate ?? null,
  }
}
