# The Planner

Answers "What should I do now?" and "What should I do today?" from the student's
tasks, schedule and preferences. **Rule-based and deterministic**: the same input
always gives the same plan; no AI, no randomness. A future AI assistant should
read the planner's output, not replace it.

## Architecture

```
Planner page / Dashboard (React: display and actions only)
  -> PlannerProvider (src/lib/planner-store.tsx): one planner for every page,
     rebuilt only when the data or the current minute changes; plans cached per date
  -> plannerInputFor (src/lib/planner-input.ts): the student's saved data ->
     tasks, events (own + Canvas/Blackboard, in the student's time zone),
     study sessions, weekly commitments, preferences
  -> createPlanner (generate-plan.ts)      day-by-day simulation -> DailyPlan per date
       availability.ts   free time and the day's study budget
       scoring.ts        remaining work, task scores and their reasons
       warnings.ts       "Needs attention"
       what-now.ts       "What should I do now?"
       timeline.ts       one day as an ordered list (Planner and Dashboard)
  -> study sessions (the student's decisions: accept, done, partly done, skip, reschedule)
```

Recommendations are computed, not stored. What the student does with one is
stored as a study session (`scheduled`, `completed` [+ `completed_minutes`],
`skipped`), and the plan is rebuilt from that. The notification service reads the
same stored sessions.

## Available time (availability.ts)

For one day: the study window (from now, if it's today) minus the student's events,
Canvas and Blackboard events, weekly commitments and study sessions already on the
calendar, then:
- a **transition** after fixed events (`transitionMinutes`, default 15: no study
  block starts the minute class ends),
- a **break** after study (`breakMinutes`, the student's preference),
- a **budget**: at most the daily study limit (minus study already booked) and at
  most `maxShareOfFreeTime` (60%) of the free time, so the day isn't packed
  (meals, travel, rest, the unexpected). Meals the student wants protected can be
  added as weekly commitments.

## Remaining work

`remaining = estimate − work done − booked sessions still ahead`. A partly done
session counts the minutes actually worked (`completed_minutes`: "45 of 90"). A
session that ended without being marked done is **missed**: it's never marked done
automatically, it doesn't count, so its work is planned again straight away. Tasks
without an estimate use a 60-minute fallback and are flagged.

## Task scoring (scoring.ts, weights in settings.ts `DEFAULT_SCORING`)

The score is a sum of independent factors; each factor also produces the
"Why this?" text, so the explanation is always the real reason.

| Factor | Points (default) | When |
| --- | --- | --- |
| Deadline | overdue 100, today 90, tomorrow 75, 2-3 days 55, 4-7 days 35, later 15 | always (urgency grows as the deadline nears) |
| Priority | critical 40, high 30, medium 15, low 5 | always |
| Major work | 10 | exam/project/paper/presentation due within 7 days |
| Large task | 10 | 2h+ left, due in 1-7 days (start early) |
| Already started | 5 | some work done |
| Tight on time | 15 | remaining work > study time before the deadline |
| Competing deadlines | 8 | fits alone, but not with the other work due by then |
| Missed session | 8 | a planned session for it was missed in the last week |

Ties: earlier deadline, due time, title, id (deterministic). No single factor
always wins: a low-priority task due today (90 + 5) beats a critical one due in a
week (35 + 40). Overdue work is urgent but still limited by the day's budget, so
it can't take over the whole day.

## Planning strategy (optional input: `strategy`)

Used only by the AI planning layer's what-if scenarios (src/server/planning); the
app's normal plan never sets it. `boosts` add points to a task's score with the
student's own reason ("You said this is your focus", "Exam focus (your choice)"),
shown in "Why this?"; `dayLimits` lower a day's study limit (a lighter day) and
can never raise it. Neither can move study into busy time, outside the study
window or past the daily limit.

## Multi-day planning and study sessions (generate-plan.ts)

Days are simulated in order from today (14 days ahead); each day assumes the
earlier days' recommendations happen. For each task the day's target is:
due today/tomorrow (or overdue) -> all of it; otherwise an even share of the days
left (at least one block), more if the later days can't hold the rest. So a 4-hour
project due Friday becomes blocks on several days, not a last-day cram. Blocks use
the student's preferred length (30/45/60/90), never more than 2 hours without a
break, adapt to real gaps, and stay before a same-day due time.

## Replanning

Nothing is rebuilt by hand. The plan is recomputed (and cached per date) whenever
tasks, events, study sessions, weekly commitments, external events, preferences or
the current minute change: completing or partly completing work, changing a due
date, priority or estimate, adding or moving events, missing a session.
Duplicates can't happen: recommendation ids are deterministic
(`<task>@<date>T<start>`), accepted sessions are subtracted from the remaining
work, a manually scheduled session is booked time the plan goes around, and a
skipped (rejected) task isn't recommended again that day.

## What should I do now? (what-now.ts)

From today's plan and the current minute, in this order:
1. **studying**: an accepted session is happening now -> keep going.
2. **busy**: a fixed event (own, weekly, Canvas, Blackboard) is happening now ->
   no study; when it ends and the next recommended session.
3. **work**: the plan's next session starts now -> that task, the free time right
   now and the fixed item that ends it (`nextCommitment`: "You have 3h free
   before Soccer Practice (5:00 PM)"), due / priority / remaining work, and "Why
   this?" (the score factors plus "You have 45m free right now").
4. **no-time**: limit reached, outside study hours, or no usable gap -> the next
   realistic opportunity (later today, or tomorrow's plan).
5. **done**: nothing needs doing.
The Dashboard and the Planner page both render this same answer.

## Needs attention (warnings.ts)

Overdue tasks; work that didn't fit today; important work due tomorrow; **not
enough time** ("Database Project: 4h left, but only about 2h of study time before
it's due tomorrow", or no study time at all); **missed sessions**; little free
time; missing estimates. Facts only: nothing is changed automatically.

## Time zones

The planner works in the student's wall-clock time: `now` has the student's local
fields (from the `tz` cookie), external events are converted from instants with the
zone's own rules (DST-safe) before planning, and tasks without a time are due at
the end of their day.

## Notifications

The notification service (src/lib/notifications) reads the stored study sessions:
a session starting soon, a moved session (the reminder follows the new time), a
skipped or completed one (no more reminders), a missed one. The daily plan reminder
counts the Planner's own plan. No scheduling logic is duplicated there.

## Limitations

- The planner doesn't know about meals or travel unless they're on the calendar
  (as events or weekly commitments); it keeps 40% of free time unplanned instead.
- Recommendations for later days assume earlier ones happen; they're re-planned
  as things change.
- Beyond 14 days the planner doesn't estimate capacity (treated as plenty).
