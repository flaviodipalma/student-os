import { byStart, toMinutes } from "@/lib/events"
import { addDays, formatDuration } from "@/lib/format"
import { isDone } from "@/lib/tasks"
import type { CalendarEvent, Task } from "@/lib/types"
import type { Planner } from "./generate-plan"
import { completedMinutesFor, estimateOf, reasonsOf } from "./scoring"
import type { ScoredTask, StudySession } from "./types"

// "What should I do now?" — the most useful thing the student can realistically do
// at this moment, read straight from the planner's plan (no separate logic, no AI):
//
//   1. studying   an accepted study session is happening now: keep going
//   2. busy       a fixed event is happening now (class, practice, work, Canvas or
//                 Blackboard event): never study during it; say when it ends and
//                 what's next
//   3. work       the plan's next session starts now (within the planner's
//                 15-minute rounding): work on that task, with "Why this?"
//   4. no-time    nothing fits right now: the next realistic opportunity (later
//                 today, or the next day's plan)
//   5. done       nothing needs doing (no tasks, all done, or nothing left to plan)
//
// Everything comes from the same DailyPlan the Planner page and Dashboard show.

export type NextStudy = { date: string; startTime: string; endTime: string; task: Task; session: StudySession }

export type WhatNow =
  | { kind: "studying"; task: Task; session: StudySession; until: string; details: TaskDetails; reasons: string[] }
  | {
      kind: "work"
      task: Task
      session: StudySession
      // Free minutes from now until the next fixed item (or the end of the study window).
      availableMinutes: number
      details: TaskDetails
      reasons: string[]
    }
  | { kind: "busy"; event: CalendarEvent; until: string; next: NextStudy | null }
  | { kind: "no-time"; reason: "limit-reached" | "outside-window" | "no-gap" | "nothing-fits"; next: NextStudy | null }
  | { kind: "done"; reason: "no-tasks" | "all-done" | "covered"; next: NextStudy | null }

export type TaskDetails = {
  // Work still to do on the task (estimate − work done), in minutes.
  remainingMinutes: number
  estimateMissing: boolean
}

// Sessions starting within this many minutes count as "now" (the planner rounds to 15).
const NOW_WINDOW = 15

export function whatNow(input: {
  planner: Planner
  // The student's current time (local fields = the student's wall clock) and today.
  now: Date
  today: string
  // Today's schedule (events, weekly commitments, external events, study sessions).
  schedule: CalendarEvent[]
  // Every calendar item (for work already done on a task).
  events: CalendarEvent[]
  tasks: Task[]
}): WhatNow {
  const { planner, now, today, schedule, events } = input
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const plan = planner.planFor(today)
  const taskById = new Map(input.tasks.map((task) => [task.id, task]))
  const scoredById = new Map(plan.ranked.map((scored) => [scored.task.id, scored]))

  const details = (task: Task): TaskDetails => {
    const estimate = estimateOf(task, planner.settings)
    return {
      remainingMinutes: Math.max(0, estimate.minutes - completedMinutesFor(task.id, events)),
      estimateMissing: estimate.missing,
    }
  }
  const upcoming = (sessions: StudySession[], from: number) =>
    sessions
      .filter((s) => (s.status === "scheduled" || s.status === "suggested") && taskById.has(s.taskId))
      .filter((s) => toMinutes(s.startTime) >= from)
      .sort((a, b) => a.startTime.localeCompare(b.startTime))
  const asNext = (session: StudySession | undefined): NextStudy | null =>
    session ? { date: session.date, startTime: session.startTime, endTime: session.endTime, task: taskById.get(session.taskId)!, session } : null
  // The next study session later today, else the first in the next day's plan.
  const nextStudy = (from: number) => {
    const later = upcoming([...plan.existingSessions, ...plan.suggestions], from)[0]
    if (later) return asNext(later)
    const tomorrow = planner.planFor(addDays(today, 1))
    return asNext(upcoming([...tomorrow.existingSessions, ...tomorrow.suggestions], 0)[0])
  }

  // 1. An accepted session happening now.
  const studying = plan.existingSessions.find(
    (s) => s.status === "scheduled" && toMinutes(s.startTime) <= nowMinutes && nowMinutes < toMinutes(s.endTime)
  )
  const studyingTask = studying && taskById.get(studying.taskId)
  if (studying && studyingTask && !isDone(studyingTask)) {
    return {
      kind: "studying",
      task: studyingTask,
      session: studying,
      until: studying.endTime,
      details: details(studyingTask),
      reasons: ["You planned this session", ...reasonsFor(scoredById.get(studyingTask.id))],
    }
  }

  // 2. A fixed event happening now: never recommend studying through it.
  const busy = schedule
    .filter((e) => e.type !== "study" && toMinutes(e.startTime) <= nowMinutes && nowMinutes < toMinutes(e.endTime))
    .sort((a, b) => b.endTime.localeCompare(a.endTime))[0]
  if (busy) return { kind: "busy", event: busy, until: busy.endTime, next: nextStudy(toMinutes(busy.endTime)) }

  // 3. The plan's next session starts now.
  const startingNow = upcoming([...plan.existingSessions, ...plan.suggestions], nowMinutes).find(
    (s) => toMinutes(s.startTime) - nowMinutes <= NOW_WINDOW
  )
  const task = startingNow && taskById.get(startingNow.taskId)
  if (startingNow && task) {
    const nextBusy = [...schedule]
      .sort(byStart)
      .map((e) => toMinutes(e.startTime))
      .find((start) => start > nowMinutes)
    const windowEnd = toMinutes(planner.settings.dayEnd)
    const availableMinutes = Math.max(0, Math.min(nextBusy ?? windowEnd, windowEnd) - nowMinutes)
    const sessionReasons = startingNow.status === "suggested" && "reasons" in startingNow ? (startingNow.reasons as string[]) : reasonsFor(scoredById.get(task.id))
    return {
      kind: "work",
      task,
      session: startingNow,
      availableMinutes,
      details: details(task),
      reasons: [...sessionReasons.filter((reason) => !/^Fits your available time$/.test(reason)), `You have ${formatDuration(availableMinutes)} free right now`],
    }
  }

  // 4-5. Nothing to start now.
  if (plan.status === "no-tasks" || plan.status === "all-done") return { kind: "done", reason: plan.status, next: null }
  const next = nextStudy(nowMinutes)
  if (plan.ranked.length === 0 && plan.existingSessions.every((s) => s.status !== "scheduled")) {
    return { kind: "done", reason: "covered", next }
  }
  const start = toMinutes(planner.settings.dayStart)
  const end = toMinutes(planner.settings.dayEnd)
  const reason =
    plan.status === "limit-reached"
      ? "limit-reached"
      : nowMinutes < start || nowMinutes >= end
        ? "outside-window"
        : upcoming(plan.suggestions, nowMinutes).length > 0 || upcoming(plan.existingSessions, nowMinutes).length > 0
          ? "no-gap"
          : "nothing-fits"
  return { kind: "no-time", reason, next }
}

function reasonsFor(scored: ScoredTask | undefined): string[] {
  return scored ? reasonsOf(scored) : []
}
