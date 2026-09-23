import "server-only"

import type { LmsAssignment, LmsCourse } from "@/lib/lms/types"
import { fetchIcsFeed, type Fetch } from "../feed-fetch"
import { parseIcs, type IcsEvent } from "../ical"
import { utcToLocalDue } from "../normalize"
import { LmsError } from "../provider"
import { parseBlackboardBaseUrl } from "./config"

// Reading a student's Blackboard CALENDAR LINK (Blackboard Ultra > Calendar >
// Calendar Settings > Share Calendar): a private iCalendar link every student
// can make, no administrator approval needed.
//
// What Blackboard puts in it (checked against a real Learn feed, Sept 2026):
//   PRODID   -//Blackboard//EN;  X-WR-CALNAME the institution's name
//   UID      "_blackboard.platform.gradebook2.GradableItem-<column id>" for gradable
//            items, where <column id> ("_1598993_1") is the SAME id as the REST
//            API's gradebook column: a student who later signs in keeps their tasks
//   SUMMARY  the item's title
//   DTSTART  the due time (TZID=<zone>); DESCRIPTION empty
//   Nothing says which course an item belongs to, and there's no link.
//   Items span a year back and a year ahead.
// So feed items go into one "Blackboard" course the student can rename or move
// tasks out of, and only items due from today on are imported: the feed can't
// say whether older work was turned in, and a year of past items would flood
// the Planner with overdue tasks.
//
// The link works like a password: it's stored encrypted, only fetched by the
// server, never shown again or logged.

const FEED_PATH = /^\/webapps\/calendar\/calendarFeed\/[A-Za-z0-9_.-]+\/learn\.ics$/
const GRADABLE_ITEM_UID = /^_blackboard\.platform\.gradebook2\.GradableItem-(_\d+_\d+)$/

// The one course feed items go into (the feed doesn't name courses).
export const BLACKBOARD_FEED_COURSE_ID = "calendar-feed"

export function parseBlackboardFeedUrl(input: string, allowedHosts: string[]): { baseUrl: string; feedUrl: string } {
  const invalid = new LmsError(
    "Paste the calendar link from Blackboard (Calendar > Calendar Settings > Share Calendar). It looks like https://school.blackboard.com/webapps/calendar/calendarFeed/…/learn.ics"
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
  const baseUrl = parseBlackboardBaseUrl(url.origin, allowedHosts)
  return { baseUrl, feedUrl: `${baseUrl}${url.pathname}${url.search}` }
}

export function fetchBlackboardFeed(feedUrl: string, fetchImpl: Fetch = fetch): Promise<string> {
  return fetchIcsFeed(
    feedUrl,
    {
      unavailable: "Blackboard is temporarily unavailable. Please try again.",
      linkBroken: "This Blackboard calendar link no longer works. Copy a new one from Blackboard.",
      unreadable: "Blackboard sent a calendar Student OS couldn't read.",
      tooLarge: "This Blackboard calendar is too large to import.",
      notACalendar: "That link didn't return a Blackboard calendar. Check that you copied the Share Calendar link.",
    },
    fetchImpl
  )
}

export type BlackboardFeedData = {
  courses: LmsCourse[]
  assignments: LmsAssignment[]
  // Gradable items due before today (not imported).
  pastItems: number
  // Events that aren't gradable items, or have no title or due time.
  skippedEvents: number
}

// Feed events -> one "Blackboard" course and its upcoming gradable items.
export function blackboardFeedToLms(
  text: string,
  context: { timeZone: string | undefined; today: string }
): BlackboardFeedData {
  const assignments: LmsAssignment[] = []
  let pastItems = 0
  let skippedEvents = 0
  for (const event of parseIcs(text)) {
    const assignment = assignmentFrom(event, context.timeZone)
    if (!assignment) skippedEvents++
    else if (assignment.dueDate && assignment.dueDate < context.today) pastItems++
    else assignments.push(assignment)
  }
  const courses: LmsCourse[] =
    assignments.length > 0
      ? [
          {
            provider: "blackboard",
            externalId: BLACKBOARD_FEED_COURSE_ID,
            courseCode: "BLACKBOARD",
            courseName: "Blackboard",
            description: "Assignments from your Blackboard calendar. Rename this course or move tasks to the right course.",
            instructor: null,
            url: null,
          },
        ]
      : []
  return { courses, assignments, pastItems, skippedEvents }
}

function assignmentFrom(event: IcsEvent, timeZone: string | undefined): LmsAssignment | null {
  const uid = event.uid?.match(GRADABLE_ITEM_UID)
  const title = event.summary?.replace(/\s+/g, " ").trim()
  if (!uid || !title || !event.start) return null
  const due =
    event.start.kind === "date"
      ? { dueDate: event.start.date, dueTime: null }
      : utcToLocalDue(event.start.instant.toISOString(), timeZone)
  if (!due) return null
  return {
    provider: "blackboard",
    // Same id as the REST API's gradebook column.
    externalId: uid[1],
    courseExternalId: BLACKBOARD_FEED_COURSE_ID,
    title,
    description: event.description?.trim() || null,
    dueDate: due.dueDate,
    dueTime: due.dueTime,
    type: "assignment",
    url: null,
    estimatedMinutes: null,
    submissionStatus: "unknown",
  }
}
