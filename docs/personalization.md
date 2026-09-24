# Long-term personalization

Student OS gradually learns how one student works and uses it to plan better.
It stays deterministic, explainable and under the student's control, and it
never replaces the Planner. This builds on adaptive planning
(docs/adaptive-planning.md) and the AI planning layer (docs/ai-planning.md).

```
Student data (tasks, courses, events, weekly commitments, study sessions, Canvas/Blackboard/Google/Outlook)
  ↓
Behavior history (finished tasks with logged work; session outcomes and moves)
  ↓
Adaptive planning service        src/lib/adaptive (analyzeHistory): pure, deterministic
  ↓
StudentPlanningProfile           src/lib/adaptive/profile.ts: explicit / observed / inferred
  ↓
Planning context                 plannerInputFor: learned estimates, times used last,
                                 preferred times, pacing, the planning mode
  ↓
Deterministic Planner            src/lib/planner: the only thing that schedules
  ↓
Daily plan → "What should I do now?"

AI Assistant (around it): understands the request → reads the structured context
(getLearnedPatterns, getWhatShouldIDoNow, explainPlan) → explains / simulates
(simulatePlanChange) / proposes (correctPersonalization, applyConfirmedPlanChange)
→ the Planner checks feasibility → the student confirms → saved.
```

## Three kinds of information, never mixed

| Kind | Example | Where | Weight |
| --- | --- | --- | --- |
| Explicit | "I prefer studying after 4 PM"; Exam focus mode; my own estimate for this task | Settings, the task form, or a confirmed Assistant proposal | Always wins |
| Observed | "You finished 18 of 20 afternoon sessions recently" | `profile.observed`: value, confidence, observations, newest evidence, source, explanation | Evidence only |
| Inferred | "The Planner uses late nights last" | `profile.inferred` and `PlannerInput.learned` | Soft, and only if switched on |

## What's learned (only with enough evidence)

- **Durations:**
  - estimate accuracy overall, by course + type, and by type;
  - a learned estimate per open task, with hierarchical shrinkage: the value
    starts at 1× (no change), then moves toward all tasks, then the course or
    type, then the most specific group.
  - A broader level only counts when it adds tasks and behaves like one group.
  - "All tasks" needs 3 or more kinds of task, so 8 lab reports say nothing
    about an exam.
- **Times of day:**
  - completion by morning, afternoon, evening and late night, over the last 90
    days, with a 45-day half-life, smoothed toward the student's overall rate;
  - the best time;
  - times often missed or moved, which the Planner uses last and never blocks.
- **Workload:**
  - planned vs finished study on busy days, and the share of unfinished days;
  - a soft pace when the student regularly plans more than they finish (8 or
    more such days; always below their own limit).
- **Habits** (for explanation only):
  - session completion and reschedule rate;
  - typical session length, study minutes per day and study days;
  - kinds of task often postponed;
  - sessions per large task.

## Confidence

- **Counts:** 5 or more tasks for medium and 12 or more for high (sessions and
  days have their own thresholds).
- **Consistency:** the spread (median absolute deviation ÷ median) must be 0.25
  or less for medium, and 0.15 or less for high.
- **Recency:** confidence drops one level when the newest evidence is more than
  180 days old.
- **Outliers:** tasks more than 3 median absolute deviations away are dropped.
- **Sparse evidence:** it is shrunk toward what's known, and changes under 10%
  are skipped.
- **Wording:** low confidence is always "still learning".

## Effects on the Planner (soft only)

- A learned estimate (the task keeps the student's own).
- Preferred times first, then times outside the often-missed ones, then any time.
- Pacing: non-urgent work stops at the soft target. Urgent work (due today or
  tomorrow, or tight on time) can still use the full daily limit, and held-back
  work goes to later days without warnings.
- "Fits in the time you have free now": a +10 nudge when the free window now is
  short, so a 30-minute reading goes into a 75-minute gap. Deadlines still
  weigh more.
- The planning mode (Balanced, Deadline focus, Exam focus, Light day, or "My
  settings only"). It is never changed automatically, and a what-if can try
  another mode without saving it.

Hard rules never move: events (including Canvas, Blackboard, Google and
Outlook), weekly commitments, the study window, the daily limit, breaks and
deadlines. Tests check them every day for 5 simulated students over 1–10 weeks.

## The student's controls (Settings > Personalization)

- **Planning mode.**
- **Times I prefer to study** (explicit).
- **Learn from my history:** a master switch, plus separate switches for
  learned durations, learned study times and learned pace.
- **Learned from your planning history:** insights, each with "Don't use" /
  "Use again".
- **Reset learning:** history and corrections start over; the mode and
  preferred times stay; tasks and the calendar are untouched.
- **Task form:** "Use my estimate instead" / "Let it learn again".
- **In the Assistant:** "I actually prefer studying at night", "This estimate is
  wrong", "Don't use that pattern", "Stop adapting my task durations" all go
  through `correctPersonalization`, which proposes and saves only on Confirm.

## Privacy

- Only the signed-in student's data goes in; nothing is shared across students.
- The stored behavior is minimal: session moves (a count and the first time) and
  the student's settings.
- The Assistant receives summaries (values, confidence, counts, short
  explanations), never raw history. Labels use course codes, not names.
- Nothing behavioral is logged. Deleting an account cascades to everything.

## Performance and failure

The analysis is linear and deterministic. It's memoized per data change and day
in the browser, computed once per request on the server, and takes a few
milliseconds for a semester (400 tasks and 2,000 sessions, tested). Corrupt
history is ignored. If the analysis throws, the Planner runs without it, and if
the AI fails, the Planner and "What should I do now?" are unaffected.
