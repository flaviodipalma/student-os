# The Student OS Assistant

A conversational way into the student's own Student OS data. **The Planner
decides; the Assistant explains.** The model never sees the database, a user id
or a way to save anything by itself.

## Architecture

```
Assistant page (src/components/assistant: conversation, suggestions, Confirm / Cancel)
  -> askAssistantAction / confirmAssistantAction (src/app/actions/assistant.ts)
       who is signed in (verified session), input checked with zod
  -> Assistant service (service.ts)
       loads the student's data once (loadAppData) + the same Planner the app uses
       (createPlanner(plannerInputFor(...))) -> ToolContext (context.ts)
  -> StudentAssistantAIService (ai-service.ts)
       AnthropicAssistantService: Claude tool-use loop (max 6 rounds)
       MockAssistantService: set answers for local testing (not AI)
  -> tools (read-tools.ts, planning-tools.ts, action-tools.ts) -> structured JSON back to the model
```

Provider settings (server environment only; the key never reaches the browser):
`ASSISTANT_AI_PROVIDER` (`anthropic` default, or `mock`; falls back to
`SYLLABUS_AI_PROVIDER`), `ASSISTANT_AI_MODEL` (falls back to `SYLLABUS_AI_MODEL`,
then `claude-opus-5`), `ANTHROPIC_API_KEY`.

## Tools

Read: `getWhatShouldIDoNow` (the Planner's `whatNow`), `getTodaysPlan` (the
Planner's `DailyPlan`: schedule, sessions, priorities and reasons, warnings),
`getUpcomingDeadlines`, `getWorkloadSummary`, `getTasks`, `getTaskDetails`,
`getCourses`, `getCalendarEvents` (own, weekly, Canvas/Blackboard: read-only),
`getAvailableTime` (the Planner's `dayAvailability`), `getStudySessions`,
`getStudentPreferences`, `getNotifications` (with the rule that sent each one),
`getLearnedPatterns` (adaptive planning: insights, times of day, learned
estimates with explanation and confidence; see docs/adaptive-planning.md).

Planning (the AI planning layer, see docs/ai-planning.md): `getPlanningContext`
(work left vs realistic study time), `explainPlan` (the Planner's ranking and
reasons for a day), `simulatePlanChange` and `generatePlanningScenarios`
(what-ifs: the real Planner on a temporary copy, nothing saved),
`findAvailableTimes` (alternatives for a busy time).

Actions (proposals only): `completeTask`, `createTask`, `updateTask`,
`rescheduleStudySession`, `createStudySession`, `logStudyProgress`,
`applyConfirmedPlanChange` (accept a day's plan / take a day off),
`correctPersonalization` (preferred times, mode, learned-signal switches, turn off
a pattern, use my estimate; docs/personalization.md). Nothing can be deleted.

## Changes need the student's Confirm

1. An action tool finds the target (id or words from the title; more than one
   match -> `ambiguous`, nothing proposed), checks the change (the app's own
   validation; study session times against the Planner's availability: busy,
   outside study hours, past) and returns a `PendingAction` with a summary written
   by the server, not the model. One proposal per reply.
2. The page shows it with Confirm / Cancel (typing "yes" / "no" works too).
3. Confirm sends the action back; `confirmAssistantChange` parses it again, checks
   it again against fresh data for the signed-in student, and saves it with the
   normal task / study session services. The saved records update the app store,
   so the Planner, Calendar and reminders follow straight away.

## Safety

- User isolation: tools read only the `AppData` loaded for the session's user;
  no tool takes a user id; ids from the browser (focus task, page context,
  confirmed actions) only count if they're the student's own.
- Prompt injection: titles, descriptions, notes, course and event names are
  data. They're flattened and cut (`untrusted()`), sent as JSON string values,
  and the rules say tool data is never instructions. Even a model that "obeys"
  injected text can only propose one change, which the student sees and must
  confirm.
- Errors: provider down, timeouts, rate limits, refusals and loops all become
  "I couldn't process that right now. Please try again."; the server log gets the
  error kind only. Bad tool arguments and tool failures go back to the model as
  error results.
- Context: only the last 12 messages (text only) and the tools' results for the
  question are sent; the rules and tool definitions are prompt-cached.

## Limitations

- The conversation is kept in the browser tab only (sessionStorage), not in the
  database; the model sees text history, not earlier tool results.
- No per-student rate limit on Assistant requests yet.
- The Assistant can't delete, change preferences, integrations or Canvas /
  Blackboard events, or talk to external calendars.
