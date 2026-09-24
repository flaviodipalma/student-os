import "server-only"

import { z } from "zod"
import { toMinutes } from "@/lib/events"
import { addDays } from "@/lib/format"
import { completedMinutesFor, isMissed, reasonsOf, whatNow, type NextStudy, type StudySession } from "@/lib/planner"
import { scheduleBetween } from "@/lib/recurring"
import type { AppNotification, CalendarEvent, NotificationType, Task } from "@/lib/types"
import {
  availabilityOn,
  clampTime,
  courseCodeOf,
  lengthOf,
  relativeDay,
  remainingMinutes,
  sourceName,
  taskBrief,
  timeLabel,
  untrusted,
  type ToolContext,
} from "./context"
import { resolveTask } from "./resolve"
import { dateInput, defineTool, taskRefInput, timeInput } from "./tool"

// Read-only tools. Each one returns only what its question needs, computed by
// the app's own logic: the Planner (plans, "What should I do now?", warnings,
// availability), the shared calendar items and the notification records.

const MAJOR: Task["type"][] = ["exam", "project", "paper", "presentation"]
const byDue = (a: Task, b: Task) =>
  a.dueDate.localeCompare(b.dueDate) || (a.dueTime ?? "24:00").localeCompare(b.dueTime ?? "24:00") || a.title.localeCompare(b.title)
const open = (ctx: ToolContext) => ctx.data.tasks.filter((task) => task.status !== "completed")
const taskById = (ctx: ToolContext, id: string) => ctx.data.tasks.find((task) => task.id === id)

function sessionView(ctx: ToolContext, session: StudySession, reasons?: string[]) {
  const task = taskById(ctx, session.taskId)
  return {
    // A stored session's id, or the Planner's id for a recommendation.
    sessionId: session.eventId ?? session.id,
    taskId: session.taskId,
    task: untrusted(task?.title),
    course: courseCodeOf(ctx, task?.courseId),
    date: session.date,
    day: relativeDay(ctx, session.date),
    start: timeLabel(session.startTime),
    end: timeLabel(session.endTime),
    minutes: lengthOf(session),
    // recommended = the Planner's suggestion, not on the calendar yet.
    status: session.status === "suggested" ? "recommended" : session.status,
    ...(session.completedMinutes ? { completedMinutes: session.completedMinutes } : {}),
    ...(reasons ? { why: reasons } : {}),
  }
}

function itemView(ctx: ToolContext, item: CalendarEvent) {
  return {
    title: untrusted(item.title),
    date: item.date,
    day: relativeDay(ctx, item.date),
    start: timeLabel(item.startTime),
    end: timeLabel(item.endTime),
    kind: item.sessionId ? "study session" : item.commitmentId ? "weekly commitment" : item.type,
    source: sourceName(item),
    // Canvas / Blackboard events are read-only copies: Student OS can't change them.
    readOnly: Boolean(item.source && item.source !== "student_os"),
    ...(item.location ? { location: untrusted(item.location, 80) } : {}),
    ...(item.taskId ? { taskId: item.taskId } : {}),
  }
}

function nextView(ctx: ToolContext, next: NextStudy | null) {
  return next ? sessionView(ctx, next.session) : null
}

export const getWhatShouldIDoNow = defineTool({
  name: "getWhatShouldIDoNow",
  description:
    "The Planner's answer to \"What should I do right now?\": the task to work on (or that the student is busy / out of study time / all caught up), the free time right now, remaining work and the Planner's reasons. Always use this instead of choosing a task yourself.",
  input: z.object({}),
  run(ctx) {
    const answer = whatNow({
      planner: ctx.planner,
      now: ctx.now,
      today: ctx.today,
      schedule: scheduleBetween(ctx.items, ctx.data.recurringCommitments, ctx.today, ctx.today),
      events: ctx.items,
      tasks: ctx.data.tasks,
    })
    const now = timeLabel(clampTime(ctx.now.getHours() * 60 + ctx.now.getMinutes()))
    switch (answer.kind) {
      case "work":
      case "studying":
        return {
          focusTaskId: answer.task.id,
          result: {
            now,
            answer: answer.kind === "work" ? "work on this task now" : "keep going with the session in progress",
            task: taskBrief(ctx, answer.task),
            session: sessionView(ctx, answer.session),
            ...(answer.kind === "work" ? { availableMinutes: answer.availableMinutes, freeUntil: answer.nextCommitment ? { event: untrusted(answer.nextCommitment.title), at: timeLabel(answer.nextCommitment.startTime) } : "end of your study window" } : { until: timeLabel(answer.until) }),
            remainingMinutes: answer.details.remainingMinutes,
            estimateMissing: answer.details.estimateMissing,
            // Why the Planner expects this much work (adaptive planning), if it learned it.
            learnedEstimate: ctx.adaptive?.estimates[answer.task.id] ? untrusted(ctx.adaptive.estimates[answer.task.id].explanation, 300) : null,
            why: answer.reasons,
          },
        }
      case "busy":
        return {
          focusTaskId: answer.next?.task.id,
          result: { now, answer: "busy right now, no study", currentEvent: itemView(ctx, answer.event), nextOpportunity: nextView(ctx, answer.next) },
        }
      case "no-time":
        return {
          focusTaskId: answer.next?.task.id,
          result: {
            now,
            answer: {
              "limit-reached": "today's study limit is reached",
              "outside-window": "outside the student's study hours",
              "no-gap": "no free gap right now",
              "nothing-fits": "no usable time left today",
            }[answer.reason],
            nextOpportunity: nextView(ctx, answer.next),
          },
        }
      case "done":
        return {
          focusTaskId: answer.next?.task.id,
          result: {
            now,
            answer: {
              "no-tasks": "the student has no tasks yet",
              "all-done": "all tasks are completed",
              covered: "everything needed today is already planned or done",
            }[answer.reason],
            nextOpportunity: nextView(ctx, answer.next),
          },
        }
    }
  },
})

export const getTodaysPlan = defineTool({
  name: "getTodaysPlan",
  description:
    "The Planner's daily plan for a date (default today): the schedule (classes, events, weekly commitments, Canvas/Blackboard events), study sessions (scheduled, done, missed and the Planner's recommendations with reasons), study minutes vs the daily limit, the Planner's top priorities with reasons, and Needs Attention warnings. Use for \"what does my day look like\", \"I have 2 hours tonight, what should I work on\", \"why am I behind\".",
  input: z.object({ date: dateInput.optional() }),
  run(ctx, { date = ctx.today }) {
    const plan = ctx.planner.planFor(date)
    const schedule = scheduleBetween(ctx.items, ctx.data.recurringCommitments, date, date).filter((item) => !item.sessionId)
    const sessions = [...plan.existingSessions, ...plan.suggestions]
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
      .map((s) => sessionView(ctx, s, "reasons" in s ? (s.reasons as string[]) : undefined))
    return {
      result: {
        date,
        day: relativeDay(ctx, date),
        status: plan.status,
        schedule: schedule.map((item) => itemView(ctx, item)),
        studySessions: sessions,
        studyMinutes: plan.studyMinutes,
        dailyStudyLimitMinutes: plan.studyLimit,
        priorities: plan.ranked.slice(0, 5).map((scored) => ({
          taskId: scored.task.id,
          title: untrusted(scored.task.title),
          course: courseCodeOf(ctx, scored.task.courseId),
          due: relativeDay(ctx, scored.task.dueDate),
          remainingMinutes: scored.remainingMinutes,
          estimateMissing: scored.estimateMissing,
          why: reasonsOf(scored),
        })),
        needsAttention: plan.warnings.map((w) => ({ severity: w.severity, message: untrusted(w.message, 200) })),
      },
    }
  },
})

export const getUpcomingDeadlines = defineTool({
  name: "getUpcomingDeadlines",
  description:
    "Open tasks that are overdue or due in the next `days` days (default 7), earliest first, with course, due day/time, priority and remaining work. Use for \"what's due this week / tomorrow\" and \"my most urgent deadlines\".",
  input: z.object({ days: z.int().min(0).max(60).default(7).describe("0 = due today only.") }),
  run(ctx, { days }) {
    const until = addDays(ctx.today, days)
    const due = open(ctx).filter((task) => task.dueDate <= until).sort(byDue)
    return {
      result: {
        from: ctx.today,
        until,
        count: due.length,
        overdueCount: due.filter((task) => task.dueDate < ctx.today).length,
        tasks: due.slice(0, 25).map((task) => taskBrief(ctx, task)),
        ...(due.length > 25 ? { more: due.length - 25 } : {}),
      },
    }
  },
})

export const getTasks = defineTool({
  name: "getTasks",
  description:
    "The student's tasks, earliest due first. Filter by status, course (code or name) and/or words in the title. Use to find a task's taskId before other tools.",
  input: z.object({
    status: z.enum(["open", "completed", "all"]).default("open"),
    course: z.string().trim().max(150).optional().describe("Course code or name."),
    query: z.string().trim().max(200).optional().describe("Words from the task title."),
  }),
  run(ctx, { status, course, query }) {
    let tasks = ctx.data.tasks.filter((task) =>
      status === "all" ? true : status === "open" ? task.status !== "completed" : task.status === "completed"
    )
    if (course) {
      const wanted = course.toLowerCase().replace(/\s+/g, "")
      const ids = new Set(
        ctx.data.courses
          .filter((c) => c.code.toLowerCase().replace(/\s+/g, "").includes(wanted) || c.name.toLowerCase().includes(course.toLowerCase()))
          .map((c) => c.id)
      )
      tasks = tasks.filter((task) => ids.has(task.courseId))
    }
    if (query) {
      const resolved = resolveTask(tasks, query, { includeCompleted: true })
      tasks = "found" in resolved ? [resolved.found] : "ambiguous" in resolved ? resolved.ambiguous : []
    }
    tasks = [...tasks].sort(byDue)
    return {
      focusTaskId: tasks.length === 1 ? tasks[0].id : undefined,
      result: { count: tasks.length, tasks: tasks.slice(0, 30).map((task) => taskBrief(ctx, task)) },
    }
  },
})

export const getTaskDetails = defineTool({
  name: "getTaskDetails",
  description:
    "Everything about one task: due date and time, priority, estimate, work done and left, its study sessions, where it came from (Canvas/Blackboard) and the Planner's reasons for it today. If several tasks match, returns the options instead: ask the student which one.",
  input: z.object({ task: taskRefInput }),
  run(ctx, { task: ref }) {
    const resolved = resolveTask(ctx.data.tasks, ref, { includeCompleted: true })
    if ("notFound" in resolved) return { result: { status: "not_found", message: "No task matches that in Student OS." } }
    if ("ambiguous" in resolved) return { result: { status: "ambiguous", options: resolved.ambiguous.map((t) => taskBrief(ctx, t)) } }
    const task = resolved.found
    const scored = ctx.planner.planFor(ctx.today).ranked.find((s) => s.task.id === task.id)
    const nowMinutes = ctx.now.getHours() * 60 + ctx.now.getMinutes()
    const sessions = ctx.items
      .filter((item) => item.taskId === task.id && item.sessionId)
      .filter((item) => item.date >= addDays(ctx.today, -7))
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    const course = ctx.data.courses.find((c) => c.id === task.courseId)
    return {
      focusTaskId: task.id,
      result: {
        status: "found",
        task: {
          ...taskBrief(ctx, task),
          courseName: course ? untrusted(course.name) : null,
          workDoneMinutes: completedMinutesFor(task.id, ctx.items),
          description: untrusted(task.description, 300) || null,
          notes: untrusted(task.notes, 300) || null,
          source: task.source ? { from: task.source.provider, submission: task.source.submissionStatus ?? "unknown" } : null,
          estimate: estimateView(ctx, task),
        },
        studySessions: sessions.map((item) => ({
          sessionId: item.sessionId,
          day: relativeDay(ctx, item.date),
          date: item.date,
          start: timeLabel(item.startTime),
          end: timeLabel(item.endTime),
          status: item.completed ? "completed" : isMissed(item, ctx.today, nowMinutes) ? "missed" : "scheduled",
        })),
        plannerToday: scored ? { remainingToPlanMinutes: scored.remainingMinutes, why: reasonsOf(scored) } : null,
      },
    }
  },
})

export const getCourses = defineTool({
  name: "getCourses",
  description: "The student's courses: code, name, professor (null if unknown), open tasks and the next deadline.",
  input: z.object({}),
  run(ctx) {
    return {
      result: {
        courses: ctx.data.courses.map((course) => {
          const tasks = open(ctx).filter((task) => task.courseId === course.id).sort(byDue)
          return {
            courseId: course.id,
            code: untrusted(course.code, 40),
            name: untrusted(course.name),
            professor: untrusted(course.professor, 80) || null,
            fromLms: course.source?.provider ?? null,
            openTasks: tasks.length,
            nextDeadline: tasks[0] ? { taskId: tasks[0].id, title: untrusted(tasks[0].title), due: relativeDay(ctx, tasks[0].dueDate) } : null,
          }
        }),
      },
    }
  },
})

export const getCalendarEvents = defineTool({
  name: "getCalendarEvents",
  description:
    "Everything on the student's calendar between two dates (at most 14 days): their own events, weekly commitments, study sessions and Canvas/Blackboard events (read-only). Use for \"do I have anything between 4 and 6?\".",
  input: z.object({ from: dateInput, to: dateInput.optional().describe("Inclusive; default = from.") }),
  run(ctx, { from, to = from }) {
    if (to < from) return { result: { status: "invalid", message: "`to` is before `from`." } }
    const last = to > addDays(from, 13) ? addDays(from, 13) : to
    const items = scheduleBetween(ctx.items, ctx.data.recurringCommitments, from, last)
    return {
      result: {
        from,
        to: last,
        ...(last !== to ? { note: "Only the first 14 days are included." } : {}),
        count: items.length,
        items: items.slice(0, 60).map((item) => itemView(ctx, item)),
      },
    }
  },
})

export const getAvailableTime = defineTool({
  name: "getAvailableTime",
  description:
    "Free time on a date, from the Planner's own availability rules: free blocks inside the study window (from now, if today), and the study budget the Planner would still use that day (daily limit and keeping part of the day free). Optionally only between `from` and `to` (e.g. tonight = 18:00-23:59).",
  input: z.object({ date: dateInput, from: timeInput.optional(), to: timeInput.optional() }),
  run(ctx, { date, from, to }) {
    if (date < ctx.today) return { result: { status: "past", message: "That date has passed." } }
    const day = availabilityOn(ctx, date)
    const start = from ? toMinutes(from) : 0
    const end = to ? toMinutes(to) : 24 * 60
    const blocks = day.free
      .map((block) => ({ start: Math.max(block.start, start), end: Math.min(block.end, end) }))
      .filter((block) => block.end > block.start)
    const prefs = ctx.data.preferences
    return {
      result: {
        date,
        day: relativeDay(ctx, date),
        studyWindow: { start: timeLabel(prefs.studyStart), end: timeLabel(prefs.studyEnd) },
        ...(from || to ? { between: { start: timeLabel(clampTime(start)), end: timeLabel(clampTime(end)) } } : {}),
        freeBlocks: blocks.map((b) => ({ start: timeLabel(clampTime(b.start)), end: timeLabel(clampTime(b.end)), minutes: b.end - b.start })),
        freeMinutes: blocks.reduce((sum, b) => sum + b.end - b.start, 0),
        studyAlreadyBookedMinutes: day.bookedStudyMinutes,
        dailyLimitLeftMinutes: Math.max(0, day.limitLeft),
        plannerStudyBudgetMinutes: day.budget,
        busy: day.items
          .filter((item) => (!from || toMinutes(item.endTime) > start) && (!to || toMinutes(item.startTime) < end))
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map((item) => itemView(ctx, item)),
      },
    }
  },
})

export const getStudySessions = defineTool({
  name: "getStudySessions",
  description:
    "Study sessions on the student's calendar (scheduled, completed or missed) between two dates (default today to 7 days ahead), with their sessionId. Use before moving a session.",
  input: z.object({ from: dateInput.optional(), to: dateInput.optional() }),
  run(ctx, { from = ctx.today, to = addDays(ctx.today, 7) }) {
    const nowMinutes = ctx.now.getHours() * 60 + ctx.now.getMinutes()
    const sessions = ctx.items
      .filter((item) => item.sessionId && item.date >= from && item.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))
    return {
      result: {
        count: sessions.length,
        sessions: sessions.slice(0, 40).map((item) => {
          const task = item.taskId ? taskById(ctx, item.taskId) : undefined
          return {
            sessionId: item.sessionId,
            taskId: item.taskId,
            task: untrusted(task?.title),
            day: relativeDay(ctx, item.date),
            date: item.date,
            start: timeLabel(item.startTime),
            end: timeLabel(item.endTime),
            status: item.completed ? "completed" : isMissed(item, ctx.today, nowMinutes) ? "missed" : "scheduled",
          }
        }),
      },
    }
  },
})

export const getStudentPreferences = defineTool({
  name: "getStudentPreferences",
  description: "The student's planning preferences: study window, daily study limit, preferred block length, break length and time zone.",
  input: z.object({}),
  run(ctx) {
    const p = ctx.data.preferences
    return {
      result: {
        studyWindow: { start: timeLabel(p.studyStart), end: timeLabel(p.studyEnd) },
        dailyStudyLimitMinutes: p.maxStudyMinutesPerDay,
        preferredBlockMinutes: p.preferredBlockMinutes,
        breakMinutes: p.breakMinutes,
        timeZone: ctx.timeZone ?? null,
      },
    }
  },
})

export const getWorkloadSummary = defineTool({
  name: "getWorkloadSummary",
  description:
    "How busy the next `days` days are (default 7): tasks due, total work left, major deadlines, free time and the Planner's study budget per day, and the Planner's warnings (e.g. not enough time before a deadline). Use for \"how busy is my week\" and \"why am I behind\".",
  input: z.object({ days: z.int().min(1).max(14).default(7) }),
  run(ctx, { days }) {
    const until = addDays(ctx.today, days - 1)
    const due = open(ctx).filter((task) => task.dueDate <= until).sort(byDue)
    const remaining = due.map((task) => remainingMinutes(ctx, task))
    const perDay = Array.from({ length: days }, (_, i) => {
      const date = addDays(ctx.today, i)
      const day = availabilityOn(ctx, date)
      return { date, day: relativeDay(ctx, date), freeMinutes: day.freeMinutes, plannerStudyBudgetMinutes: day.budget, alreadyBookedMinutes: day.bookedStudyMinutes }
    })
    return {
      result: {
        from: ctx.today,
        until,
        dueCount: due.length,
        overdueCount: due.filter((task) => task.dueDate < ctx.today).length,
        workLeftMinutes: remaining.reduce<number>((sum, m) => sum + (m ?? 0), 0),
        tasksWithoutEstimate: remaining.filter((m) => m === null).length,
        majorDeadlines: due
          .filter((task) => MAJOR.includes(task.type) || task.priority === "critical" || task.priority === "high")
          .slice(0, 8)
          .map((task) => taskBrief(ctx, task)),
        studyTime: {
          freeMinutes: perDay.reduce((sum, d) => sum + d.freeMinutes, 0),
          plannerStudyBudgetMinutes: perDay.reduce((sum, d) => sum + d.plannerStudyBudgetMinutes + d.alreadyBookedMinutes, 0),
          perDay,
        },
        warnings: ctx.planner.planFor(ctx.today).warnings.map((w) => ({ severity: w.severity, message: untrusted(w.message, 200) })),
      },
    }
  },
})

const reminderReason = (type: NotificationType, minutes: number): string => {
  const before = minutes >= 1440 ? "1 day" : minutes === 60 ? "1 hour" : `${minutes} minutes`
  switch (type) {
    case "task_due_soon":
      return `Sent ${before} before the task's due time (the student's reminder setting).`
    case "task_overdue":
      return "Sent once, when the task passed its due time without being marked complete."
    case "important_deadline":
      return "Sent a day ahead because the task is high or critical priority."
    case "study_session_upcoming":
      return `Sent ${before} before a scheduled study session.`
    case "study_session_missed":
      return "The study session ended without being marked done, so its work was planned again."
    case "event_upcoming":
      return `Sent ${before} before a calendar event.`
    case "daily_plan_ready":
      return "Sent once a day when the student's study window starts."
  }
}

export const getNotifications = defineTool({
  name: "getNotifications",
  description:
    "The student's recent reminders (newest first) with the actual rule that sent each one and the related task. Use for \"why did I get this reminder?\".",
  input: z.object({}),
  run(ctx) {
    const minutes = ctx.data.notificationPreferences.reminderMinutes
    const list = ctx.data.notifications.slice(0, 8)
    return {
      result: {
        count: list.length,
        reminders: list.map((n: AppNotification) => {
          const task = n.relatedTaskId ? taskById(ctx, n.relatedTaskId) : undefined
          return {
            title: untrusted(n.title),
            message: untrusted(n.message, 200),
            read: Boolean(n.readAt),
            reason: reminderReason(n.type, minutes),
            relatedTask: task ? taskBrief(ctx, task) : null,
          }
        }),
      },
    }
  },
})

// The student's own estimate next to what the Planner uses, and why (adaptive planning).
function estimateView(ctx: ToolContext, task: Task) {
  const learned = task.status === "completed" ? undefined : ctx.adaptive?.estimates[task.id]
  return {
    yoursMinutes: task.estimateMinutes,
    plannerUsesMinutes: task.status === "completed" ? null : ctx.planner.estimateOf(task).minutes,
    learned: learned
      ? { explanation: untrusted(learned.explanation, 300), confidence: learned.confidence, basedOnTasks: learned.basis.tasks }
      : null,
  }
}

export const getLearnedPatterns = defineTool({
  name: "getLearnedPatterns",
  description:
    "The student's planning profile, as computed by Student OS from their own history, in three separate parts: explicit (what they chose: planning mode, preferred study times), observed (each value with confidence, number of observations, the date of the newest evidence and its source) and inferred (what the Planner does because of it). Also the insights (each with an id for correctPersonalization, whether it affects planning and whether the student turned it off) and learned estimates for open tasks. Use for \"why is this session longer?\", \"when do I study best?\", \"why afternoon sessions?\". Only explain what this returns; never infer other patterns.",
  input: z.object({}),
  run(ctx) {
    const a = ctx.adaptive
    const settings = ctx.data.learning
    if (!a || !a.enabled) {
      return {
        result: {
          enabled: false,
          explicit: { planningMode: settings.planningMode, preferredStudyTimes: settings.preferredPeriods },
          note: "Learning from history is off (Settings > Personalization): the Planner uses the student's own estimates, settings and planning mode only.",
        },
      }
    }
    const open = ctx.data.tasks.filter((t) => t.status !== "completed")
    const text = (value: string) => untrusted(value, 300)
    const entry = <T,>(e: { value: T; confidence: string; observations: number; updatedAt: string; source: string; explanation: string } | undefined) =>
      e ? { value: e.value, confidence: e.confidence, observations: e.observations, newestEvidence: e.updatedAt, source: e.source, explanation: text(e.explanation) } : undefined
    const o = a.profile.observed
    return {
      result: {
        enabled: true,
        historySince: a.since,
        switches: { learnedEstimates: settings.useEstimates, learnedStudyTimes: settings.useStudyTimes, learnedPacing: settings.useWorkload },
        explicit: { planningMode: settings.planningMode, preferredStudyTimes: settings.preferredPeriods, tasksUsingOwnEstimate: settings.ownEstimateTaskIds.length },
        observed: {
          sessionCompletionRate: entry(o.sessionCompletionRate),
          rescheduleRate: entry(o.rescheduleRate),
          typicalSessionMinutes: entry(o.typicalSessionMinutes),
          typicalStudyMinutesPerDay: entry(o.typicalStudyMinutesPerDay),
          typicalStudyDays: entry(o.typicalStudyDays),
          bestStudyTime: entry(o.bestStudyTime),
          oftenMissedTimes: entry(o.oftenMissedTimes),
          estimateAccuracy: entry(o.estimateAccuracy),
          estimatesByKind: o.estimatesByKind.map((e) => entry(e)),
          unfinishedDayRate: entry(o.unfinishedDayRate),
          oftenPostponedTypes: entry(o.oftenPostponedTypes),
          sessionsPerLargeTask: entry(o.sessionsPerLargeTask),
        },
        inferred: a.profile.inferred.map((i) => ({ text: text(i.text), confidence: i.confidence })),
        insights: a.insights.map((i) => ({ id: i.id, text: text(i.text), confidence: i.confidence, observations: i.observations, affectsPlanning: i.affectsPlanning, turnedOff: i.dismissed })),
        finishedTasksLearnedFrom: a.observations,
        timesOfDay: a.periods
          .filter((p) => p.sessions > 0)
          .map((p) => ({ period: p.label, sessions: p.sessions, completed: p.completed, missed: p.missed, skipped: p.skipped, moved: p.moved, recentCompletionRate: p.completionRate })),
        pacing: a.pacing ? { softMinutes: a.pacing.softMinutes, confidence: a.pacing.confidence, reason: a.pacing.reason } : null,
        learnedEstimates: open
          .filter((t) => a.estimates[t.id])
          .slice(0, 10)
          .map((t) => {
            const e = a.estimates[t.id]
            return { ...taskBrief(ctx, t), yoursMinutes: e.userMinutes, plannerUsesMinutes: e.minutes, confidence: e.confidence, explanation: text(e.explanation) }
          }),
        ...(a.observations === 0 && a.insights.length === 0 ? { note: "Not enough history yet: plans use the student's own estimates and preferences." } : {}),
      },
    }
  },
})

export const readTools = [
  getWhatShouldIDoNow,
  getTodaysPlan,
  getUpcomingDeadlines,
  getWorkloadSummary,
  getTasks,
  getTaskDetails,
  getCourses,
  getCalendarEvents,
  getAvailableTime,
  getStudySessions,
  getStudentPreferences,
  getNotifications,
  getLearnedPatterns,
]
