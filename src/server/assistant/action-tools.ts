import "server-only"

import { z } from "zod"
import type { PendingAction, ProposedAction } from "@/lib/assistant"
import { fromMinutes, toMinutes } from "@/lib/events"
import { formatDuration } from "@/lib/format"
import { priorityLabel, typeLabel } from "@/lib/tasks"
import type { Task } from "@/lib/types"
import { taskFields } from "@/lib/validation"
import { availabilityOn, dayLabel, lengthOf, relativeDay, remainingMinutes, taskBrief, timeLabel, untrusted, type ToolContext } from "./context"
import { resolveCourse, resolveTask } from "./resolve"
import { dateInput, defineTool, taskRefInput, timeInput, type ToolOutput } from "./tool"

// Tools that change something. None of them saves anything: each one finds the
// target, checks the change (the same rules as the app's forms, and the
// Planner's availability for study sessions) and returns a proposal. The student
// sees it with Confirm / Cancel; only Confirm saves it (see service.ts), after
// checking it again against fresh data. Nothing here can delete.

type Check = { ok: true; pending: PendingAction } | { ok: false; problem: string; freeBlocks?: { start: string; end: string }[] }

const quote = (title: string) => `“${untrusted(title)}”`
// "tomorrow at 5:00 PM", "Fri, Sep 25"
export function dueText(ctx: ToolContext, date: string, time?: string | null): string {
  const day = relativeDay(ctx, date)
  const label = day === "Today" || day === "Tomorrow" || day === "Yesterday" ? day.toLowerCase() : dayLabel(date)
  return time ? `${label} at ${timeLabel(time)}` : label
}

// ---- Study session times, checked with the Planner's availability.

type SlotCheck = { ok: true; note?: string } | { ok: false; problem: string; freeBlocks: { start: string; end: string }[] }

export function checkSlot(ctx: ToolContext, date: string, startTime: string, endTime: string, withoutSessionId?: string): SlotCheck {
  const start = toMinutes(startTime)
  const end = toMinutes(endTime)
  const day = availabilityOn(ctx, date, withoutSessionId)
  const freeBlocks = day.free.map((b) => ({ start: timeLabel(fromMinutes(b.start)), end: timeLabel(fromMinutes(b.end)) }))
  if (end <= start) return { ok: false, problem: "The session must end after it starts.", freeBlocks }
  if (date < ctx.today) return { ok: false, problem: "That day has already passed.", freeBlocks: [] }
  if (day.free.some((block) => block.start <= start && end <= block.end)) {
    const over = end - start > day.limitLeft
    return over
      ? { ok: true, note: `This goes over your daily study limit (${formatDuration(ctx.data.preferences.maxStudyMinutesPerDay)}).` }
      : { ok: true }
  }
  const clashes = day.items.filter((item) => toMinutes(item.startTime) < end && start < toMinutes(item.endTime))
  if (clashes.length > 0) {
    const names = clashes.slice(0, 3).map((item) => `${untrusted(item.title, 60)} (${timeLabel(item.startTime)}–${timeLabel(item.endTime)})`)
    return { ok: false, problem: `That time isn't free: it overlaps with ${names.join(", ")}.`, freeBlocks }
  }
  const prefs = ctx.data.preferences
  if (start < toMinutes(prefs.studyStart) || end > toMinutes(prefs.studyEnd)) {
    return {
      ok: false,
      problem: `That's outside your study hours (${timeLabel(prefs.studyStart)}–${timeLabel(prefs.studyEnd)}).`,
      freeBlocks,
    }
  }
  return { ok: false, problem: "That time has already passed.", freeBlocks }
}

// ---- The checks for each kind of change (also run again on Confirm).

export function prepareAction(ctx: ToolContext, action: ProposedAction): Check {
  const taskOf = (id: string) => ctx.data.tasks.find((task) => task.id === id)
  switch (action.kind) {
    case "complete-task": {
      const task = taskOf(action.taskId)
      if (!task) return { ok: false, problem: "That task doesn't exist in Student OS." }
      if (task.status === "completed") return { ok: false, problem: `${quote(task.title)} is already complete.` }
      return { ok: true, pending: { action, summary: `Mark ${quote(task.title)} as complete.`, confirmLabel: "Mark complete" } }
    }

    case "create-task": {
      const parsed = taskFields.safeParse({ ...action.task, description: "", status: "not_started" })
      if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Some details aren't valid." }
      const course = ctx.data.courses.find((c) => c.id === action.task.courseId)
      if (!course) return { ok: false, problem: "That course doesn't exist in Student OS." }
      if (action.task.dueDate < ctx.today) return { ok: false, problem: "That due date has already passed." }
      const t = parsed.data
      const estimate = t.estimateMinutes ? `, about ${formatDuration(t.estimateMinutes)}` : ", no estimate"
      const duplicate = ctx.data.tasks.some(
        (task) => task.courseId === course.id && task.status !== "completed" && task.title.toLowerCase() === t.title.toLowerCase()
      )
      return {
        ok: true,
        pending: {
          action,
          summary: `Add ${quote(t.title)} (${untrusted(course.code, 40)}, ${typeLabel[t.type].toLowerCase()}) due ${dueText(ctx, t.dueDate, t.dueTime)}${estimate}, ${priorityLabel[t.priority].toLowerCase()} priority.`,
          ...(duplicate ? { note: "You already have an open task with this name in that course." } : {}),
          confirmLabel: "Add task",
        },
      }
    }

    case "update-task": {
      const task = taskOf(action.taskId)
      if (!task) return { ok: false, problem: "That task doesn't exist in Student OS." }
      const parsed = changesSchema.safeParse(action.changes)
      if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Some details aren't valid." }
      const c = parsed.data
      const parts: string[] = []
      if (c.title !== undefined && c.title !== task.title) parts.push(`rename to ${quote(c.title)}`)
      const newDate = c.dueDate ?? task.dueDate
      const newTime = c.dueTime === undefined ? task.dueTime : c.dueTime ?? undefined
      if (newDate !== task.dueDate || newTime !== task.dueTime) {
        if (newDate < ctx.today) return { ok: false, problem: "That due date has already passed." }
        parts.push(`move the deadline from ${dueText(ctx, task.dueDate, task.dueTime)} to ${dueText(ctx, newDate, newTime)}`)
      }
      if (c.priority !== undefined && c.priority !== task.priority) {
        parts.push(`change priority from ${priorityLabel[task.priority].toLowerCase()} to ${priorityLabel[c.priority].toLowerCase()}`)
      }
      if (c.estimateMinutes !== undefined && c.estimateMinutes !== task.estimateMinutes) {
        parts.push(c.estimateMinutes === null ? "remove the estimate" : `set the estimate to ${formatDuration(c.estimateMinutes)}`)
      }
      if (c.status !== undefined && c.status !== task.status) parts.push(c.status === "in_progress" ? "mark it in progress" : "mark it not started")
      if (parts.length === 0) return { ok: false, problem: `That wouldn't change anything on ${quote(task.title)}.` }
      return { ok: true, pending: { action, summary: `${quote(task.title)}: ${parts.join(", ")}.`, confirmLabel: "Save change" } }
    }

    case "schedule-session": {
      const task = taskOf(action.taskId)
      if (!task) return { ok: false, problem: "That task doesn't exist in Student OS." }
      if (task.status === "completed") return { ok: false, problem: `${quote(task.title)} is already complete.` }
      let from = ""
      if (action.sessionId) {
        const stored = ctx.data.studySessions.find((s) => s.id === action.sessionId && s.taskId === task.id)
        if (!stored) return { ok: false, problem: "That study session doesn't exist in Student OS." }
        if (stored.status !== "scheduled") return { ok: false, problem: "Only a scheduled study session can be moved." }
        from = ` from ${dueText(ctx, stored.date)} at ${timeLabel(stored.startTime)}`
      }
      const slot = checkSlot(ctx, action.date, action.startTime, action.endTime, action.sessionId)
      if (!slot.ok) return slot
      const when = `${dueText(ctx, action.date)}, ${timeLabel(action.startTime)}–${timeLabel(action.endTime)}`
      return {
        ok: true,
        pending: {
          action,
          summary: action.sessionId
            ? `Move your ${quote(task.title)} study session${from} to ${when}.`
            : `Schedule a ${quote(task.title)} study session ${when}.`,
          ...(slot.note ? { note: slot.note } : {}),
          confirmLabel: action.sessionId ? "Move session" : "Schedule session",
        },
      }
    }

    case "log-progress": {
      const task = taskOf(action.taskId)
      if (!task) return { ok: false, problem: "That task doesn't exist in Student OS." }
      if (task.status === "completed") return { ok: false, problem: `${quote(task.title)} is already complete.` }
      const minutes = toMinutes(action.endTime) - toMinutes(action.startTime)
      if (minutes < 5 || minutes > 12 * 60) return { ok: false, problem: "Record between 5 minutes and 12 hours of work." }
      // Work already done: never in the future.
      const nowMinutes = ctx.now.getHours() * 60 + ctx.now.getMinutes()
      if (action.date > ctx.today || (action.date === ctx.today && toMinutes(action.endTime) > nowMinutes + 5)) {
        return { ok: false, problem: "Only work you've already done can be recorded." }
      }
      const left = remainingMinutes(ctx, task)
      return {
        ok: true,
        pending: {
          action,
          summary: `Record ${formatDuration(minutes)} of work on ${quote(task.title)} (${dueText(ctx, action.date)}, ${timeLabel(action.startTime)}–${timeLabel(action.endTime)}).`,
          ...(left !== null ? { note: `About ${formatDuration(Math.max(0, left - minutes))} of the estimate would be left; the Planner plans only that.` } : {}),
          confirmLabel: "Record progress",
        },
      }
    }
  }
}

const changesSchema = taskFields
  .pick({ title: true, dueDate: true, priority: true, estimateMinutes: true })
  .extend({
    dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time.").nullable(),
    status: z.enum(["not_started", "in_progress"]),
  })
  .partial()

// ---- From a checked proposal (or a problem) to the tool's result.

function proposal(check: Check, focusTaskId?: string): ToolOutput {
  if (!check.ok) {
    return { focusTaskId, result: { status: "not_possible", problem: check.problem, ...(check.freeBlocks ? { freeBlocksThatDay: check.freeBlocks } : {}) } }
  }
  return {
    focusTaskId,
    pending: check.pending,
    result: {
      status: "needs_confirmation",
      summary: check.pending.summary,
      ...(check.pending.note ? { note: check.pending.note } : {}),
      instruction: "Nothing is saved yet. The student sees Confirm / Cancel buttons. Say in one short sentence what will change and ask them to confirm. Don't say it's done.",
    },
  }
}

function unresolved(ctx: ToolContext, result: { ambiguous: Task[] } | { notFound: true }): ToolOutput {
  return "ambiguous" in result
    ? { result: { status: "ambiguous", instruction: "Ask the student which one they mean. Change nothing.", options: result.ambiguous.map((t) => taskBrief(ctx, t)) } }
    : { result: { status: "not_found", problem: "No open task matches that in Student OS." } }
}

// ---- The tools.

export const completeTask = defineTool({
  name: "completeTask",
  description: "Propose marking a task complete (\"I finished my Psychology Reading\"). The student confirms before it's saved.",
  input: z.object({ task: taskRefInput }),
  run(ctx, { task: ref }) {
    const found = resolveTask(ctx.data.tasks, ref)
    if (!("found" in found)) return unresolved(ctx, found)
    return proposal(prepareAction(ctx, { kind: "complete-task", taskId: found.found.id }), found.found.id)
  },
})

export const createTask = defineTool({
  name: "createTask",
  description:
    "Propose a new task. Needs a title, the course and a due date; ask the student for anything missing instead of guessing. The student confirms before it's saved.",
  input: z.object({
    title: z.string().trim().min(1).max(200),
    course: z.string().trim().max(150).optional().describe("Course code or name. Omit if the student didn't say."),
    dueDate: dateInput,
    dueTime: timeInput.optional().describe("Only if the student gave one."),
    type: z.enum(["assignment", "exam", "quiz", "project", "paper", "reading", "lab", "presentation", "study", "other"]).default("assignment"),
    priority: z.enum(["low", "medium", "high", "critical"]).default("medium"),
    estimateMinutes: z.int().min(1).max(10000).optional().describe("Only if the student said how long it takes."),
  }),
  run(ctx, input) {
    const courses = ctx.data.courses
    let courseId: string | undefined
    if (input.course) {
      const found = resolveCourse(courses, input.course)
      if ("ambiguous" in found) {
        return { result: { status: "ambiguous", instruction: "Ask which course. Change nothing.", options: found.ambiguous.map((c) => ({ courseId: c.id, code: untrusted(c.code, 40), name: untrusted(c.name) })) } }
      }
      if ("notFound" in found) return { result: { status: "not_found", problem: "No course matches that in Student OS.", courses: courses.map((c) => untrusted(c.code, 40)) } }
      courseId = found.found.id
    } else if (courses.length === 1) {
      courseId = courses[0].id
    } else {
      return {
        result: {
          status: "needs_info",
          instruction: courses.length === 0 ? "The student has no courses yet: they need to add one first (Courses page)." : "Ask which course it's for.",
          courses: courses.map((c) => untrusted(c.code, 40)),
        },
      }
    }
    return proposal(
      prepareAction(ctx, {
        kind: "create-task",
        task: {
          courseId,
          title: input.title,
          type: input.type,
          dueDate: input.dueDate,
          ...(input.dueTime ? { dueTime: input.dueTime } : {}),
          priority: input.priority,
          estimateMinutes: input.estimateMinutes ?? null,
        },
      })
    )
  },
})

export const updateTask = defineTool({
  name: "updateTask",
  description:
    "Propose changes to a task: title, due date/time (the deadline), priority, estimate or status (not started / in progress; use completeTask to finish). Only include fields that change. The student confirms before it's saved.",
  input: z.object({
    task: taskRefInput,
    changes: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      dueDate: dateInput.optional(),
      dueTime: timeInput.nullable().optional().describe("null removes the due time."),
      priority: z.enum(["low", "medium", "high", "critical"]).optional(),
      estimateMinutes: z.int().min(1).max(10000).nullable().optional(),
      status: z.enum(["not_started", "in_progress"]).optional(),
    }),
  }),
  run(ctx, { task: ref, changes }) {
    const found = resolveTask(ctx.data.tasks, ref)
    if (!("found" in found)) return unresolved(ctx, found)
    return proposal(prepareAction(ctx, { kind: "update-task", taskId: found.found.id, changes }), found.found.id)
  },
})

// A session length: the given end, else the session's own length, else the preferred block.
function endFor(ctx: ToolContext, startTime: string, endTime: string | undefined, minutes: number): string | null {
  if (endTime) return endTime
  const end = toMinutes(startTime) + minutes
  return end < 24 * 60 ? fromMinutes(end) : null
}

export const rescheduleStudySession = defineTool({
  name: "rescheduleStudySession",
  description:
    "Propose moving a study session (a scheduled one, or one the Planner recommended) to another date/time. Pass the sessionId from an earlier result, or the task. Keeps the session's length unless endTime is given. Checks the new time is free with the Planner's availability. The student confirms before it's saved.",
  input: z.object({
    sessionId: z.string().trim().max(200).optional(),
    task: taskRefInput.optional(),
    date: dateInput,
    startTime: timeInput,
    endTime: timeInput.optional(),
  }),
  run(ctx, { sessionId, task: ref, date, startTime, endTime }) {
    const stored = sessionId ? ctx.data.studySessions.find((s) => s.id === sessionId) : undefined
    // The Planner's recommendations have ids like "<taskId>@<date>T<start>".
    const recommended = sessionId && !stored ? ctx.planner.planFor(sessionId.split("@")[1]?.slice(0, 10) ?? ctx.today).suggestions.find((s) => s.id === sessionId) : undefined
    let taskId = stored?.taskId ?? recommended?.taskId
    let target: { id?: string; minutes: number } | undefined = stored
      ? { id: stored.id, minutes: lengthOf(stored) }
      : recommended
        ? { minutes: lengthOf(recommended) }
        : undefined

    if (!target) {
      if (sessionId && !ref) return { result: { status: "not_found", problem: "That study session doesn't exist in Student OS." } }
      if (!ref) return { result: { status: "needs_info", instruction: "Ask which task's session to move." } }
      const found = resolveTask(ctx.data.tasks, ref)
      if (!("found" in found)) return unresolved(ctx, found)
      taskId = found.found.id
      const nowMinutes = ctx.now.getHours() * 60 + ctx.now.getMinutes()
      const upcoming = ctx.data.studySessions.filter(
        (s) => s.taskId === taskId && s.status === "scheduled" && (s.date > ctx.today || (s.date === ctx.today && toMinutes(s.endTime) > nowMinutes))
      )
      if (upcoming.length > 1) {
        return {
          focusTaskId: taskId,
          result: {
            status: "ambiguous",
            instruction: "Ask which session to move. Change nothing.",
            options: upcoming.map((s) => ({ sessionId: s.id, day: relativeDay(ctx, s.date), start: timeLabel(s.startTime), end: timeLabel(s.endTime) })),
          },
        }
      }
      const suggestion = ctx.planner.planFor(ctx.today).suggestions.find((s) => s.taskId === taskId)
      target = upcoming[0]
        ? { id: upcoming[0].id, minutes: lengthOf(upcoming[0]) }
        : { minutes: suggestion ? lengthOf(suggestion) : ctx.data.preferences.preferredBlockMinutes }
    }

    const end = endFor(ctx, startTime, endTime, target.minutes)
    if (!end) return { result: { status: "not_possible", problem: "The session would run past midnight." } }
    return proposal(
      prepareAction(ctx, { kind: "schedule-session", taskId: taskId!, ...(target.id ? { sessionId: target.id } : {}), date, startTime, endTime: end }),
      taskId
    )
  },
})

export const createStudySession = defineTool({
  name: "createStudySession",
  description:
    "Propose putting a new study session for a task on the calendar. Length = endTime, else the student's preferred block. Checks the time is free with the Planner's availability. The student confirms before it's saved.",
  input: z.object({ task: taskRefInput, date: dateInput, startTime: timeInput, endTime: timeInput.optional() }),
  run(ctx, { task: ref, date, startTime, endTime }) {
    const found = resolveTask(ctx.data.tasks, ref)
    if (!("found" in found)) return unresolved(ctx, found)
    const end = endFor(ctx, startTime, endTime, ctx.data.preferences.preferredBlockMinutes)
    if (!end) return { result: { status: "not_possible", problem: "The session would run past midnight." } }
    return proposal(prepareAction(ctx, { kind: "schedule-session", taskId: found.found.id, date, startTime, endTime: end }), found.found.id)
  },
})

export const logStudyProgress = defineTool({
  name: "logStudyProgress",
  description:
    "Propose recording work the student already did on a task (\"I worked 45 minutes on my essay\", \"I did half of my project\": use getTaskDetails for the estimate first). Saved as a completed study session ending now, so the Planner plans only what's left. The student confirms before it's saved.",
  input: z.object({ task: taskRefInput, minutes: z.int().min(5).max(720).describe("How long the student worked.") }),
  run(ctx, { task: ref, minutes }) {
    const found = resolveTask(ctx.data.tasks, ref)
    if (!("found" in found)) return unresolved(ctx, found)
    // Ending now (rounded down to 5 minutes), within today.
    const end = Math.floor((ctx.now.getHours() * 60 + ctx.now.getMinutes()) / 5) * 5
    const start = Math.max(0, end - minutes)
    if (end - start < 5) return { result: { status: "not_possible", problem: "It's too early today to record that much work; record it with the Planner's Partly done instead." } }
    return proposal(
      prepareAction(ctx, { kind: "log-progress", taskId: found.found.id, date: ctx.today, startTime: fromMinutes(start), endTime: fromMinutes(end) }),
      found.found.id
    )
  },
})

export const actionTools = [completeTask, createTask, updateTask, rescheduleStudySession, createStudySession, logStudyProgress]
