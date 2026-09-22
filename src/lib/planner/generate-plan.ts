import { byStart, durationMinutes, fromMinutes, toMinutes } from "@/lib/events"
import { daysBetween, fromDateKey, toDateKey } from "@/lib/format"
import { isDone } from "@/lib/tasks"
import type { CalendarEvent, Task } from "@/lib/types"
import { findFreeSlots, roundUp, totalMinutes, type Slot } from "./availability"
import { DEFAULT_PLANNER_SETTINGS, type PlannerSettings } from "./settings"
import type { DailyPlan, StudySession, UnscheduledTask } from "./types"
import { calculateTaskUrgency } from "./urgency"

export type PlanInput = {
  date: string
  tasks: Task[]
  events: CalendarEvent[]
  // The current time. Decides what "today" is and stops the planner using time that has passed.
  now: Date
  // Tasks the student removed from this date's plan.
  skippedTaskIds?: string[]
  settings?: Partial<PlannerSettings>
}

// Minutes of a task already covered by study sessions on the calendar:
// completed sessions (any day) plus sessions from today onward.
// A past session that wasn't marked done doesn't count; it was probably missed.
export function plannedMinutesFor(taskId: string, events: CalendarEvent[], today: string): number {
  return events
    .filter((e) => e.type === "study" && e.taskId === taskId && (e.completed || e.date >= today))
    .reduce((sum, e) => sum + durationMinutes(e), 0)
}

// How much of a task's remaining time to aim for on one day.
// Due today or tomorrow (or overdue): all of it. Otherwise spread it evenly over
// the days left, but never less than one short block so progress actually happens.
export function dailyTarget(remaining: number, daysLeft: number, settings: PlannerSettings): number {
  if (daysLeft <= 1) return remaining
  const share = roundUp(remaining / daysLeft, 15)
  return Math.min(remaining, Math.max(share, settings.minBlockMinutes))
}

// The block length we'd like for `left` minutes of work. Anything longer than the
// maximum is split into equal blocks (3h -> 2 x 90 min).
function idealBlock(left: number, settings: PlannerSettings): number {
  if (left <= settings.maxBlockMinutes) return roundUp(left, 5)
  const blocks = Math.ceil(left / settings.maxBlockMinutes)
  return roundUp(left / blocks, 15)
}

// Shrinks a block to fit `space` minutes, snapping to a standard length.
function fitBlock(wanted: number, space: number, settings: PlannerSettings): number {
  if (wanted <= space) return wanted
  const sizes = settings.blockSizes.filter((size) => size <= space && size <= wanted && size >= settings.minBlockMinutes)
  return sizes.length > 0 ? Math.max(...sizes) : 0
}

export function generatePlan(input: PlanInput): DailyPlan {
  const settings = { ...DEFAULT_PLANNER_SETTINGS, ...input.settings }
  const { date, tasks, events, now } = input
  const today = toDateKey(now)
  const skipped = input.skippedTaskIds ?? []

  const dayEvents = events.filter((e) => e.date === date)
  const existingSessions: StudySession[] = dayEvents
    .filter((e) => e.type === "study" && e.taskId)
    .sort(byStart)
    .map((e) => ({
      id: e.id,
      eventId: e.id,
      taskId: e.taskId!,
      date,
      startTime: e.startTime,
      endTime: e.endTime,
      status: e.completed ? "completed" : "scheduled",
    }))
  const existingStudy = dayEvents.filter((e) => e.type === "study").reduce((sum, e) => sum + durationMinutes(e), 0)

  const plan: DailyPlan = {
    date,
    status: "ok",
    suggestions: [],
    existingSessions,
    unscheduled: [],
    skippedTaskIds: skipped,
    studyMinutes: existingStudy,
    studyLimit: settings.maxStudyMinutesPerDay,
    freeMinutes: 0,
  }
  if (date < today) return { ...plan, status: "past" }

  // 1. Free time: gaps between events, inside the planning hours, and not in the past.
  const dayEnd = toMinutes(settings.dayEnd)
  let dayStart = toMinutes(settings.dayStart)
  if (date === today) dayStart = Math.max(dayStart, roundUp(now.getHours() * 60 + now.getMinutes(), 15))
  const slots: Slot[] = findFreeSlots(dayEvents, dayStart, dayEnd)
  plan.freeMinutes = totalMinutes(slots)
  const hasUsableTime = slots.some((slot) => slot.end - slot.start >= settings.minBlockMinutes)

  // 2. Tasks that need time: not done, not skipped, not already covered by sessions,
  //    and not due before this date (overdue work is only planned for today).
  const candidates = tasks
    .filter((task) => !isDone(task) && !skipped.includes(task.id))
    .filter((task) => task.dueDate >= date || date === today)
    .map((task) => ({ task, remaining: task.estimateMinutes - plannedMinutesFor(task.id, events, today) }))
    .filter(({ remaining }) => remaining > 0)
    // 3. Most urgent first (ties: earlier due date first).
    .sort(
      (a, b) =>
        calculateTaskUrgency(b.task, date) - calculateTaskUrgency(a.task, date) ||
        a.task.dueDate.localeCompare(b.task.dueDate)
    )
  if (candidates.length === 0) return { ...plan, status: "no-tasks" }

  // 4. Study budget: the daily limit minus study already booked, and never more
  //    than a share of the day's open time. Study already booked counts as used
  //    open time, so accepting a suggestion doesn't make room for extra study.
  const limitLeft = settings.maxStudyMinutesPerDay - existingStudy
  const shareLeft = Math.floor((plan.freeMinutes + existingStudy) * settings.maxShareOfFreeTime) - existingStudy
  let budget = Math.max(0, Math.min(limitLeft, shareLeft))

  // 5. Give each task its share of today, in order, in the earliest gaps that fit.
  const suggestions: StudySession[] = []
  const unscheduled: UnscheduledTask[] = []
  for (const { task, remaining } of candidates) {
    const daysLeft = daysBetween(fromDateKey(date), fromDateKey(task.dueDate))
    // Work due later today has to finish before its due time.
    const cutoff = task.dueDate === date && task.dueTime ? Math.min(dayEnd, toMinutes(task.dueTime)) : dayEnd
    let left = dailyTarget(remaining, Math.max(daysLeft, 0), settings)
    let scheduled = 0
    let hitLimit = false

    while (left > 0) {
      // If the study budget can't cover the ideal block, fall back to the
      // largest standard block it can cover.
      let wanted = idealBlock(left, settings)
      if (wanted > budget) {
        const sizes = settings.blockSizes.filter((size) => size <= budget && size >= settings.minBlockMinutes)
        wanted = sizes.length > 0 ? Math.max(...sizes) : 0
      }
      if (wanted <= 0) {
        hitLimit = true
        break
      }
      const slot = slots.find((s) => fitBlock(wanted, Math.min(s.end, cutoff) - s.start, settings) > 0)
      if (!slot) break
      const length = fitBlock(wanted, Math.min(slot.end, cutoff) - slot.start, settings)
      const start = slot.start
      suggestions.push({
        id: `${task.id}@${date}T${fromMinutes(start)}`,
        taskId: task.id,
        date,
        startTime: fromMinutes(start),
        endTime: fromMinutes(start + length),
        status: "suggested",
      })
      // Use up the slot, plus a short break before any next study block.
      slot.start = Math.min(slot.end, start + length + settings.breakMinutes)
      left = Math.max(0, left - length)
      budget -= length
      scheduled += length
    }

    if (left > 0) {
      // Out of budget while free time remains = the daily limit stopped it.
      // Otherwise the day simply ran out of free time.
      const freeTimeLeft = slots.some(
        (slot) => Math.min(slot.end, cutoff) - slot.start >= Math.min(left, settings.minBlockMinutes)
      )
      unscheduled.push({
        taskId: task.id,
        missingMinutes: left,
        scheduledMinutes: scheduled,
        reason: hitLimit && freeTimeLeft ? "daily-limit" : "no-time",
        atRisk: daysLeft <= 2,
      })
    }
  }

  suggestions.sort((a, b) => a.startTime.localeCompare(b.startTime))
  return {
    ...plan,
    status: limitLeft <= 0 ? "limit-reached" : !hasUsableTime && suggestions.length === 0 ? "no-time" : "ok",
    suggestions,
    unscheduled,
    studyMinutes: existingStudy + suggestions.reduce((sum, s) => sum + toMinutes(s.endTime) - toMinutes(s.startTime), 0),
  }
}
