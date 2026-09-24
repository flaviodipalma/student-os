# Adaptive planning

Student OS learns from one student's own history and uses it as **soft**
input to the deterministic Planner. The Planner stays the authority on what's
possible.

```
tasks + study sessions (BehaviorHistory)
  -> analyzeHistory               src/lib/adaptive (pure, deterministic)
  -> AdaptivePlanningContext      learned estimates, times of day, workload, insights
  -> learnedPlanning(context)     PlannerInput.learned (soft only)
  -> Planner                      src/lib/planner: same hard rules as always
  -> DailyPlan, "What should I do now?", "Why this?"
AdaptivePlanningContext -> Assistant tools (getLearnedPatterns, getTaskDetails) -> explanations
```

`plannerInputFor` builds it for every Planner in the app (browser, Assistant,
reminders, what-if scenarios). In the browser it's memoized per data change and
day (`useAdaptiveContext`), not per render or per minute.

## What's recorded (database)

Migration `0013_adaptive_planning`:

- `study_sessions.reschedule_count`, `first_date`, `first_start_time`: how often
  a scheduled session was moved, and where it was first planned. Set by
  `updateStudySession`; nothing else is logged.
- `student_preferences.adaptive_planning` (on by default) and `adaptive_since`
  (set by "Reset learning").

Everything else comes from data the app already has: finished tasks, their
estimates, and completed, partly done, skipped and missed study sessions.

## Learned estimates

- **Observation:** a finished task with logged work (completed sessions; partly
  done ones count the minutes worked). It's used as a ratio (actual ÷ estimate)
  only if the logged time is at least 15 minutes and at least 25% of the
  estimate. Lower means the work probably wasn't all logged.
- **Evidence order:** the most specific group with enough history wins:
  course + type (3 or more), then course (3 or more), then type (3 or more),
  then all tasks (5 or more).
- **Robust:** a recency-weighted median (the weight halves every 90 days) of at
  most 20 recent observations. Outliers more than 3 MADs from the median are
  dropped, so one 240-minute task among 60–75-minute ones is ignored.
- **Safe:** the typical ratio is shrunk toward the student's estimate by
  n / (n + 3), capped at 0.6×–1.8×, and changes under 10% are skipped.
- **No estimate:** the typical actual duration of similar tasks, shrunk toward
  the fallback and kept between 15 and 600 minutes.
- **Confidence:** "high" needs 12 or more tasks with a spread of 0.15 or less.
  "Medium" needs 5 or more with a spread of 0.25 or less. Anything else is
  "low". Spread is the median absolute deviation divided by the median. With
  only old history (the newest observation more than 180 days ago), confidence
  drops one level. Low confidence is worded "still learning".
- The task keeps the student's estimate. The Planner gets `{ minutes, reason }`
  next to it, and "Why this?" shows the reason.

## Times of day

Sessions from before today are grouped by when they started: morning (5–12),
afternoon (12–17), evening (17–21) and late night (21–24). Each is counted as
completed, missed, skipped or moved; a moved session counts against the time it
was first planned.

A time is **used last** only if all of these hold:

- it has 6 or more sessions;
- 40% or fewer of them were completed;
- another time is at least 30 points better and has 4 or more sessions.

The Planner then takes the earliest free time outside it and falls back to it
only when nothing else fits. So urgent work still gets planned, and nothing
becomes impossible. On today, the next hour is never avoided, so "What should
I do now?" stays useful.

## Workload

Planned vs completed study on days with 1 hour or more on the calendar, over
the last 28 days (5 or more days needed). This is an insight only: the daily
limit is never changed automatically.

## The student's controls (Settings > Adaptive planning)

- **Learn from my planning history:** turning it off makes the Planner use
  only the student's own estimates and study preferences.
- **Reset learning:** history before today stops counting and the recorded
  session moves are cleared. Tasks, courses, sessions and the calendar are
  untouched.
- **Learned from your planning history:** insights, shown only with enough
  data.
- The task form shows the learned estimate's explanation next to the student's
  own estimate.

## Privacy

Only the signed-in student's own data goes in. Deleting an account removes
everything (cascade). The Assistant gets structured summaries (numbers,
confidence, short explanations), not raw history. Labels use course codes, never
course names or descriptions. Nothing behavioral is written to logs.

## Tests

- `src/lib/adaptive/adaptive.test.ts` (26 tests):
  - cold start, sparse data, confidence, outliers, caps;
  - changing behavior, the evidence order, tasks without an estimate;
  - times of day, moves, workload;
  - on/off, reset, deleted history, partly done sessions, determinism.
- `src/lib/planner/learned.test.ts` (10 tests): learned estimates in the plan
  and in "What should I do now?", hard constraints, times used last, urgent
  work, the next-hour rule, and `plannerInputFor`.
- `src/server/services/adaptive-planning.test.ts` (11 tests):
  - move recording, on/off, reset, isolation;
  - the Assistant's explanations, and prompt injection through course names.

## Limitations

- Time actually spent is known only when the student logs it (marks sessions
  done, or records progress). Work done off the plan isn't seen.
- Rescheduling is recorded only from this release on, and only for sessions
  moved in Student OS.
- The Planner's own suggestions aren't stored, so ignoring a suggestion without
  pressing Skip isn't a signal.
- Workload tolerance and preferred times are insights. They don't pull study
  toward good times; they only use poor times last.
