# AI planning layer

An AI layer **around** the deterministic Planner, inside the existing Assistant.
The AI understands what the student means; the Planner decides what is possible.

```
Student: "I have soccer every afternoon, keep today light and focus on my exam"
  -> Assistant (Claude, tool use)                   src/server/assistant
  -> PlanningIntent (structured, zod, strict)       src/server/planning/intent.ts
  -> resolveIntent: every task/course is the student's own; dates in range
  -> buildScenario: the real Planner on a TEMPORARY copy of the student's data
                                                    src/server/planning/scenario.ts
  -> candidate plans (feasible / partly / not), goals, numbers, "Why this?"
  -> the AI explains and recommends
  -> real change? applyConfirmedPlanChange -> PendingAction -> student presses Confirm
  -> confirmAssistantChange checks everything again -> study sessions saved
```

## Planning Intent

What the student asked for, and nothing else: `mode` (balanced, deadline-focus,
exam-focus, light-day), `focusTasks`, `focusCourses`, `avoid` (task/course, on a
date or at all), `unavailable` (date, optional from/to), `lightDays`,
`maxStudyMinutes`, `finishBy` (task, date), and `whatIf` (hypothetical due date,
estimate or "finished").

- It holds **preferences and temporary constraints, never facts**. It can't
  create events, change deadlines or mark work done.
- The schema is strict (unknown fields are errors); all dates must be today to
  30 days ahead; unclear task/course names come back as `ambiguous` with the
  options; other students' ids are `not_found`.

## How it reaches the Planner

`PlannerInput.strategy` (src/lib/planner/types.ts): `boosts` add score points
with the student's reason, shown in "Why this?"; `dayLimits` lower a day's
study limit. Unavailable times become busy blocks in the copy only; `avoid`
becomes skipped tasks in the copy; what-ifs change task copies. The Planner's
hard rules (fixed items, study window, daily limit, breaks, block length) are
untouched, so a scenario can never contain an impossible session.

| Mode | Effect |
| --- | --- |
| balanced | the normal plan |
| deadline-focus | +25 for work due in the next 3 days |
| exam-focus | +30 for exams and quizzes due in the next 10 days |
| light-day | half the usual daily limit on those days (default today) |
| focus task / course | +40 / +25 |
| finish-by | +20, and the goal date used as the deadline in the copy |

## Tools (src/server/assistant/planning-tools.ts)

| Tool | Saves? |
| --- | --- |
| `getPlanningContext`: work left vs realistic study time until a date, per day | no |
| `explainPlan`: the Planner's ranking, scores and reasons for a day | no |
| `simulatePlanChange`: one what-if, compared with the current plan | no |
| `generatePlanningScenarios`: 2-3 options, deterministic ranking | no |
| `findAvailableTimes`: free times of N minutes over a range of days | no |
| `applyConfirmedPlanChange`: accept a day's plan / take a day off | only after Confirm |

Two new confirmed changes (`ProposedAction`): `accept-sessions` (each session
checked against real free time, no overlaps, the student's own open tasks; saved
in one transaction) and `skip-day` (the day's planned work saved as skipped
sessions, like Skip on the Planner page, so it moves to other days).

## What should I do now?

`whatNow` now returns `nextCommitment`: the card says "You have 3h free before
Soccer Practice (5:00 PM)" and the Assistant's answer uses the same fact
(`freeUntil`). The Dashboard never calls the AI: the card is the Planner's answer.

## Cost

AI is only called when the student sends a message on the Assistant page. The
Dashboard, Planner page and "What should I do now?" are deterministic. Scenarios
reuse the data loaded once per message; a 7-day scenario is 7 in-memory Planner
runs (milliseconds). Rules and tool definitions are prompt-cached.

## Tests

`src/server/planning/planning.test.ts`: intent validation, ownership and
ambiguity; hard constraints in every scenario; tonight off, light day, exam
focus, focus task, finish-by, several deadlines; the database unchanged by every
planning tool; conflicts with alternatives; accept/skip only after Confirm and
re-checked (other students, busy time, overlaps, past days); malformed and
injected tool calls; AI failure; the six example conversations end to end with
the test-mode AI.

## Limitations

- Temporary constraints ("I can't study tonight") last for the conversation's
  what-ifs only; saving them means taking the day off or adding a calendar event.
- The test-mode AI understands only the example phrasings; real understanding
  needs the Claude provider.
- A light day halves the limit; there's no "30% lighter".
- Recurring preferences ("I prefer shorter sessions") are settings the student
  changes in Settings; the Assistant can't change settings.
