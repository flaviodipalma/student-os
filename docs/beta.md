# Running the Student OS beta

A small, controlled beta: a handful of students, real accounts, close contact.

## Feedback (built in)

Every signed-in page has **Send feedback** (sidebar, and the phone menu): a
kind (broken / confusing / idea / other), a message, and the page it was sent
from (a path only, never query strings). Stored in the `feedback` table for the
student, rate limited (10 an hour), Row Level Security on (only the server
reads it). Read it in the Supabase SQL editor:

```sql
select f.created_at, f.kind, f.page, f.message
from feedback f
order by f.created_at desc
limit 100;
```

Student identities are only visible by joining `auth.users` on `user_id`;
avoid doing that unless you need to reply to someone.

## What to measure (not built: no analytics service is configured)

No usage analytics are collected today. For the beta, a privacy-friendly
product-analytics tool (e.g. PostHog, self-hosted or EU cloud, or Plausible for
page views only) can be added later; track **events only, never content**
(no titles, descriptions, syllabus text, messages or emails), keyed by an
anonymous id:

| Event | Answers |
| --- | --- |
| signup completed, onboarding completed (and which steps were skipped) | Does onboarding work? Where do students drop off? |
| course created, syllabus imported (items found / imported), task created | How do students get their work in? Is the importer used and trusted? |
| planner opened, study session accepted / completed / partly done / skipped / rescheduled | Do students follow the plan? |
| "What should I do now?" seen, Start now, Open task | Is the core promise used? |
| reminder opened / dismissed | Are reminders useful or noise? |
| Assistant message sent, change proposed, confirmed / cancelled | Is the Assistant useful? Are proposals right? |
| calendar / LMS connected, sync failed | Do integrations work in the wild? |
| day-7 and day-14 return | Retention |

Until then: weekly 15-minute check-ins with each beta student, plus the
feedback table, answer most of these.

## Test matrix (automated)

`src/lib/planner/beta-profiles.test.ts` runs five kinds of student through the
real Planner for two weeks: **light workload, heavy workload, very structured
week, unpredictable schedule, several overdue tasks**. For all of them: no study
over fixed commitments, inside the study window and the daily limit, no block
over 2 hours, never more study than the work left, deterministic, and "What
should I do now?" equal to the Planner's own answer. Plus the realistic
single-student audit (`src/server/services/persona-audit.test.ts`).

## Before inviting students

- Deploy to a production-shaped environment (`docs/deployment.md`) with a real
  Anthropic key and real Supabase Auth settings.
- Try the syllabus importer on 5-10 real syllabi from different departments
  (clean, messy, tables, date ranges): the automated tests use a stand-in for the
  AI, so extraction quality on real documents is the biggest unknown.
- Try the Assistant with real students' questions (with a real key).
- Connect Google Calendar / Outlook with real accounts if those will be offered
  (OAuth apps in testing mode allow listed test users only).
- Tell beta students: reminders appear while Student OS is open (no email/push);
  all-day calendar events aren't shown yet; Canvas/Blackboard connect through the
  Student OS browser extension (Chrome, desktop).
