# Calendar: sources and external events

The Calendar, the Dashboard's "Today's plan" and the Planner all use **one set of
calendar items** (`scheduleBetween` in the app store). Each item has a **source**:

| Source | What | Stored in | Editable |
| --- | --- | --- | --- |
| Student OS | the student's events | `events` (local date + times) | yes |
| Student OS | weekly commitments | `recurring_commitments` (a rule, expanded per day) | yes |
| Student OS | study sessions | `study_sessions` | yes (Planner) |
| Canvas | Canvas calendar events | `external_calendar_events` (`source = canvas`) | no (read-only) |
| Blackboard | Blackboard calendar events | `external_calendar_events` (`source = blackboard`) | no (read-only) |
| Google Calendar | the student's Google calendars | `external_calendar_events` (`source = google`) | no (read-only) |
| Outlook | the student's Outlook calendar | `external_calendar_events` (`source = outlook`) | no (read-only) |

Google Calendar and Outlook are connected with OAuth on the Integrations page
(Calendars, separate from login); see `docs/calendar-integrations.md`.

`CalendarEvent.source` is unset for Student OS items and `"canvas"` / `"blackboard"` /
`"google"` / `"outlook"` for external ones (`EventSource` in `src/lib/types.ts`). Events, tasks and study
sessions stay distinct: a **task** is something to get done (Canvas assignments and
Blackboard gradable items become tasks, as before); an **event** occupies time (the
calendar events below); a **study session** is time set aside for a task.

**Calendar integration is not full LMS access.** Today Canvas and Blackboard are
connected through each student's private calendar feed. Full Canvas/Blackboard API
access (course details, submission status) needs each university to approve
Student OS first; see `src/server/integrations/lms/README.md`.

## Flow

```
Canvas / Blackboard calendar feed (downloaded once per sync, server-side)
  -> provider parser                 canvasFeedCalendarEvents / blackboardFeedCalendarEvents
  -> ExternalCalendarEvent            normalized, provider-independent (external-events.ts)
  -> syncExternalCalendar             shared calendar sync service (server/integrations/calendar)
  -> external_calendar_events         one row per (student, source, external id)
  -> ExternalEventRecord              loaded with the rest of the app data
  -> externalEventsAsCalendarItems    per day, in the student's time zone
  -> Calendar, Dashboard, Planner     the same items for all three
```

The feed syncs (`syncCanvasFeed`, `syncBlackboardFeed`) run on **Sync now** in
Settings. One download gives both the tasks and the calendar events; there's no
background sync yet (the service takes a `now` and a provider, so a scheduler can
call it later).

## Normalized event

`{ source, externalId, title, description, startsAt, endsAt, location, url }`.
Only what the source has: missing optional fields are `null`, nothing is invented.

- Canvas: `UID:event-calendar-event-<id>` -> externalId `calendar-event-<id>`;
  SUMMARY as Canvas writes it (`CSC215 Exam [CSC 215]`); DTSTART/DTEND (UTC);
  LOCATION; the calendar URL, kept only if it's on the student's own Canvas host.
- Blackboard: any entry that isn't a gradable item (`GradableItem-…` entries are
  due dates, so tasks); externalId = its UID; times with their TZID; a URL only on
  the student's own Blackboard host.
- **Type:** always the neutral "Other". The feeds don't say what kind an event is,
  and an event from an academic calendar isn't necessarily a class.
- **Skipped, not guessed** (counted in the sync summary): all-day items (holidays,
  "no class"), events without a start, without an end/duration, with zero length
  (a due time), longer than 7 days, with an unreadable time or an unknown time zone.

## Duplicates, updates, removals

- Unique key `(user_id, source, external_id)`: the same Canvas event synced twice is
  one row; Canvas `123` and Blackboard `123` are two rows; a Student OS event with the
  same title and time as a Canvas event is a separate item (different source).
  Nothing is ever de-duplicated by title.
- Changed in the provider (e.g. 2:00 PM -> 3:00 PM) -> the same row is updated.
- Gone from the provider -> `removed_at` is set: kept for sync integrity, no longer
  shown or planned around. Only events that hadn't ended yet are marked (feeds cover
  a limited window, so old events just age out). If it comes back, it's shown again.
- Disconnecting a calendar marks its events removed (they come back on reconnect).
- One provider failing never affects the other or the student's own events: each
  sync is separate, and existing rows stay until a successful sync changes them.
  A calendar-save problem after a successful task sync is reported in that sync's
  summary; one bad event is skipped (savepoint) and the rest are saved.

## Read-only, and hiding

External events open a details dialog (source, time, location, description,
**Open in Canvas / Blackboard** when there's a valid link), never the edit form.
Nothing is ever sent to Canvas or Blackboard.

**Hide from Student OS** sets `hidden` on the student's own copy: the event leaves
the Calendar, the Dashboard and the Planner's busy time, and stays hidden through
later syncs even if the event changes. The Calendar's "N hidden" button lists hidden
events with **Restore**. Filters (All / Student OS / Canvas / Blackboard / Google Calendar /
Outlook; default All) appear once an external calendar is connected.

## Time zones

- External times are stored as real instants (`timestamptz`), exactly as the feed
  gives them (UTC for Canvas, `TZID` local times for Blackboard, converted with the
  zone's own rules).
- They're shown in the student's time zone (the `tz` cookie from their browser,
  passed to the app store) with `Intl` via `wallClockIn`; no offsets are added or
  subtracted by hand, so daylight saving time is handled by the time zone rules.
- An event crossing midnight appears on both days (until 24:00, then from 00:00).
  On the night clocks fall back, a 1:30-1:30 AM (EDT -> EST) event keeps its real
  one-hour length.
- Student OS's own events keep their local date + times, as before.

## Security

- Rows are only read and written with the signed-in student's id (from the
  session); hiding someone else's event returns "not found". Hidden state is per
  student.
- Feed links and tokens stay encrypted on the server; the app only receives event
  data. Event links are checked when synced (same LMS host, HTTPS) and again before
  rendering; they open in a new tab with `rel="noopener noreferrer"`.
- Only error types are logged, never event contents or links.
- The table has Row Level Security on with no policies, like every table.

## Tests

`external-events.test.ts` (normalization, sync plan, time zones, DST, midnight,
Planner busy time), `server/integrations/calendar/calendar-sync.test.ts` (feed
syncs with a real database: duplicates, updates, removals, hiding, Canvas +
Blackboard together, provider failure, partial failure, user isolation),
`components/calendar/calendar-view.test.tsx` (week and day views, filters,
read-only details, hide/restore), `components/dashboard/today-schedule.test.tsx`,
and the server actions in `app/actions/integrations.test.ts`.

## Limitations

- All-day external items aren't shown (the calendar has no all-day row yet).
- Event types can't be known from the feeds, so external events are all "Other".
- Canvas includes only the calendar events it puts in the feed (Canvas decides the
  window); Blackboard's feed covers a year back and a year ahead.
- The Blackboard sample feed had no non-gradable events, so their UIDs are handled
  generically (the full UID is the id).
- No background sync: events update when the student syncs.
