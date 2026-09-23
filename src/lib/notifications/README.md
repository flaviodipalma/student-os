# Notifications & reminders

Student OS reminds students about their own work: tasks, study sessions, calendar
events (their own, weekly commitments, Canvas and Blackboard) and today's plan.
Everything comes from data Student OS already has; the Planner stays the source
of truth for recommended work. No AI.

## Architecture: generation and delivery are separate

```
student's data (tasks, study sessions, events, commitments, external events,
preferences) + today's plan from the Planner (createPlanner, as the app uses it)
  -> generateNotifications        src/lib/notifications/generate.ts   (pure, deterministic)
       which reminders are due NOW, each with a stable key
  -> syncNotifications            src/server/services/notifications.ts
       stores new ones (insert ... on conflict do nothing), dismisses unread
       reminders that no longer apply, cleans up old read/dismissed ones
  -> notifications table          one row per (student, key)
  -> delivery                     src/lib/notification-store.tsx
       the bell (notification center), the Dashboard's "Needs attention",
       and desktop notifications if the student turned them on
```

**When syncs run.** The open app calls `syncNotificationsAction` on load, every
minute, and ~1.5 s after the student's tasks or study sessions change.
`syncNotifications(db, userId, { now, timeZone })` needs nothing from the browser,
so a cron job, scheduled worker or serverless scheduled function can call it later
for every student without changes.

**Limitation (no background execution yet).** Student OS has no background job
system, and browser code only runs while a Student OS tab is open. So:
- reminders are created when the student opens the app (or while it's open), not
  while it's closed; a reminder whose moment passed while the app was closed is
  only delivered if it's still useful (see the windows below), otherwise skipped;
- desktop notifications appear only while Student OS is open in a tab (they're
  useful when that tab is in the background). There's no service worker / Web
  Push, email or SMS.
Adding a scheduler later = call `syncNotifications` on a timer; delivery outside
the app would additionally need push, email or similar.

## What is generated (src/lib/notifications/generate.ts)

`reminderMinutes` (the student's timing: 5, 15, 30, 60 or 1440) is the lead time.

| Type (DB value) | When it's delivered | Link |
| --- | --- | --- |
| TASK_DUE_SOON `task_due_soon` | from (due - lead) until due; date-only tasks at the start of the study window on the day (or the day before, for "1 day") | `/tasks?task=<id>` |
| IMPORTANT_DEADLINE `important_deadline` | high/critical tasks: a day ahead, until the regular reminder (only when the lead is shorter than a day) | `/tasks?task=<id>` |
| TASK_OVERDUE `task_overdue` | once, from the due time, for up to 7 days; imported tasks add "mark it done if you've turned it in" (feeds don't know) | `/tasks?task=<id>` |
| STUDY_SESSION_UPCOMING `study_session_upcoming` | scheduled sessions: from (start - lead) until start | `/planner?date=<date>` |
| STUDY_SESSION_MISSED `study_session_missed` | a session still "scheduled" after it ended, for 2 days (never marked done automatically) | `/planner?date=<date>` |
| EVENT_UPCOMING `event_upcoming` | own events, weekly commitment occurrences, visible Canvas/Blackboard events: from (start - lead) until start | `/calendar?date=<date>` (`&external=<id>` opens a Canvas/Blackboard event's read-only details) |
| DAILY_PLAN_READY `daily_plan_ready` | once a day, from the start of the study window, if the Planner's plan for today has study sessions or events | `/planner` |

Never generated: anything for completed tasks, skipped/completed sessions, hidden
external events, kinds the student turned off, or when notifications are off.
Messages are worded at delivery ("is due in 20 minutes", "starts tomorrow at 9:00 AM").
Study session reminders only cover sessions the student accepted into their plan
(stored as study sessions); the Planner's unaccepted suggestions aren't commitments,
and they're summed up by the daily plan reminder instead.

New types: add to `notificationTypes` (src/lib/types.ts), the `notification_type`
enum (migration), the generator, and `notificationMeta` (icon and action label).

## Duplicate prevention

Each reminder has a stable key: type + what + when, e.g.
`task_due_soon:<task>:<due instant>:<lead>`, `study_session_missed:<session>:<start>`,
`event_upcoming:external:<id>:<start>:<lead>`, `daily_plan_ready:<local date>`.
The table has `unique (user_id, dedupe_key)` and the service inserts with
`on conflict do nothing`, so page loads, refreshes, several tabs, logins, Planner
recalculations and Canvas/Blackboard syncs can never create a second copy.
A dismissed reminder keeps its row (and key), so it never comes back.

## Adapting to changes

- Task completed: no new reminders; its unread reminders are dismissed on the next sync.
- Due date changed / session moved / external event changed: the key contains the
  due or start instant, so the new time is a new reminder and the old time is no
  longer generated (reminders are only stored when they're due, never in advance).
- Session marked done or skipped: its unread reminders are dismissed.
- Task or session deleted: its reminders are deleted (foreign keys, cascade).

## Preferences

Stored on `student_preferences` (the same row and service as study preferences):
`notifications_enabled` (master), `remind_tasks`, `remind_study_sessions`,
`remind_events`, `remind_overdue`, `remind_daily_plan`, `reminder_minutes`
(5/15/30/60/1440, default 30), `browser_notifications` (default off). Edited in
Settings > Notifications. Turning on desktop notifications is the only time the
browser is asked for permission; if it's denied, everything still works in the app.

## Time zones

Due times, session and event times are the student's local wall-clock times,
converted to instants with the student's zone (`instantAt` in src/lib/time-zone.ts:
the zone's own rules, DST included; no fixed offsets). Canvas/Blackboard events are
already instants. "Today", "tomorrow" and clock times in messages use the same zone.
Tasks without a time are due at 11:59 PM local.

## Security

Every query and update filters by the signed-in student's id. Marking read or
dismissing someone else's reminder returns "not found". A reminder's related task
must belong to the same student (composite foreign key), links must be in-app
paths (check constraint), and deep links only open data in the student's own store.
Row Level Security is on with no policies, like every table.

## Files

- `src/lib/notifications/generate.ts`: generation (pure) and its tests
- `src/server/services/notifications.ts`: sync, list, read, dismiss (+ tests)
- `src/server/services/preferences.ts`: notification preferences
- `src/app/actions/notifications.ts`: server actions (+ tests)
- `src/lib/notification-store.tsx`: browser delivery (sync timer, desktop notifications)
- `src/components/notifications/notification-center.tsx`: the bell and list
- `src/components/dashboard/needs-attention.tsx`, `src/components/settings/notification-settings-fields.tsx`
- `drizzle/0007_notifications.sql`
