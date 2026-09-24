import { byStart, fromMinutes, toMinutes } from "@/lib/events"
import { addDays, daysBetween, formatDuration, fromDateKey, toDateKey } from "@/lib/format"
import { isDone } from "@/lib/tasks"
import type { CalendarEvent, Task } from "@/lib/types"
import { dayAvailability, roundDown, roundUp, type DayAvailability } from "./availability"
import {
  compareScored,
  completedMinutesFor,
  estimateOf,
  isMissed,
  missedSessionsFor,
  plannedMinutesFor,
  reasonsOf,
  scoreTask,
  workedMinutes,
} from "./scoring"
import { DEFAULT_PLANNER_SETTINGS, DEFAULT_SCORING, type PlannerSettings } from "./settings"
import type { DailyPlan, PlannerInput, ScoredTask, StudySession, UnscheduledTask } from "./types"
import { buildWarnings } from "./warnings"

// The planner: rule-based and deterministic (same input, same plan; no AI, no
// randomness). For each day it runs:
//
//   1. Normalize the schedule: events, study sessions and weekly commitments on that day
//   2. Available time: free blocks in the study window, and the day's study budget
//   3. Remaining work per task: estimate − work done (partly done sessions count
//      the minutes worked) − booked sessions still ahead − planned on earlier days.
//      Missed sessions don't count, so their work is planned again.
//   4. Score the open tasks (scoring.ts) and sort them, highest first
//   5. Give each task its share of the day, in the earliest free blocks that fit,
//      in the student's preferred block length, with breaks, within the budget
//   6. Record what didn't fit, and build "Needs attention" (warnings.ts)
//
// Days are planned in order, starting today: a later day's plan assumes the
// earlier days' recommendations happen, so big tasks are spread over several
// days instead of piling up. Recommendations aren't stored; accepting,
// completing or removing one stores a study session, and the plan is rebuilt.

export type Planner = {
  settings: PlannerSettings
  // The estimate the Planner uses for a task (learned, if adaptive planning has one).
  estimateOf: (task: Task) => ReturnType<typeof estimateOf>
  // The plan for one date. Plans are computed once per planner and cached.
  planFor: (date: string) => DailyPlan
}

export function createPlanner(input: PlannerInput): Planner {
  const settings: PlannerSettings = {
    ...DEFAULT_PLANNER_SETTINGS,
    ...input.settings,
    scoring: input.settings?.scoring ?? DEFAULT_SCORING,
  }
  const { now, events } = input
  // A day's settings: the usual ones, with a lower study limit if the student asked for one.
  const settingsOn = (date: string): PlannerSettings => {
    const limit = input.strategy?.dayLimits?.[date]
    return limit === undefined ? settings : { ...settings, maxStudyMinutesPerDay: Math.max(0, Math.min(settings.maxStudyMinutesPerDay, limit)) }
  }
  const today = toDateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const commitments = input.recurringCommitments ?? []
  const openTasks = input.tasks.filter((task) => !isDone(task))

  // Per task: its estimate, whether work has started, and the work still to plan.
  const learnedEstimate = (task: Task) => estimateOf(task, settings, input.learned?.estimates?.[task.id])
  const estimates = new Map(openTasks.map((task) => [task.id, learnedEstimate(task)]))
  const started = new Map(
    openTasks.map((task) => [task.id, task.status === "in_progress" || completedMinutesFor(task.id, events) > 0])
  )
  const baselineRemaining = () =>
    new Map(
      openTasks.map((task) => [
        task.id,
        Math.max(0, estimates.get(task.id)!.minutes - plannedMinutesFor(task.id, events, today, nowMinutes)),
      ])
    )

  // Each day's availability before the planner adds anything (for lookahead).
  const baseline = new Map<string, DayAvailability>()
  const availabilityOn = (date: string) => {
    if (!baseline.has(date)) baseline.set(date, dayAvailability(date, events, commitments, now, settingsOn(date)))
    return baseline.get(date)!
  }
  // Study time the planner could find from `from` to `to` (inclusive). Beyond
  // the lookahead the planner doesn't guess: it's treated as plenty.
  const capacityBetween = (from: string, to: string) => {
    if (to < from) return 0
    if (daysBetween(fromDateKey(from), fromDateKey(to)) >= settings.lookaheadDays) return Infinity
    let total = 0
    for (let date = from; date <= to; date = addDays(date, 1)) total += availabilityOn(date).budget
    return total
  }

  // Remaining work of the other open tasks due on or before `task`'s deadline.
  const competingMinutes = (task: Task, remaining: Map<string, number>) =>
    openTasks
      .filter((other) => other.id !== task.id && other.dueDate <= task.dueDate)
      .reduce((sum, other) => sum + (remaining.get(other.id) ?? 0), 0)

  function planDay(date: string, remaining: Map<string, number>): DailyPlan {
    // 1-2. The day's schedule and free time (a fresh copy: placing sessions uses it up).
    const day = dayAvailability(date, events, commitments, now, settingsOn(date))
    const skipped = input.skipped?.[date] ?? []
    const plan: DailyPlan = {
      date,
      status: "ok",
      suggestions: [],
      existingSessions: existingSessionsOn(day.items, date, today, nowMinutes),
      unscheduled: [],
      skippedTaskIds: skipped,
      ranked: [],
      available: day.free,
      studyMinutes: day.bookedStudyMinutes,
      studyLimit: settingsOn(date).maxStudyMinutesPerDay,
      freeMinutes: day.freeMinutes,
      warnings: [],
    }

    // 3-4. Open tasks that need time on this day, scored and sorted.
    //      Overdue work is only planned for today; skipped tasks wait for another day.
    plan.ranked = openTasks
      .filter((task) => !skipped.includes(task.id))
      .filter((task) => task.dueDate >= date || date === today)
      .filter((task) => remaining.get(task.id)! > 0)
      .map((task) =>
        scoreTask(
          task,
          {
            date,
            today,
            remainingMinutes: remaining.get(task.id)!,
            estimateMissing: estimates.get(task.id)!.missing,
            started: started.get(task.id)!,
            capacityBeforeDue: capacityBetween(date, task.dueDate <= date ? date : addDays(task.dueDate, -1)),
            competingMinutes: competingMinutes(task, remaining),
            missedSessions: missedSessionsFor(task.id, events, today, nowMinutes),
            boost: input.strategy?.boosts?.[task.id],
          },
          settings.scoring
        )
      )
      .map((scored) => ({ ...scored, capacityThroughDue: capacityBetween(date, scored.task.dueDate < date ? date : scored.task.dueDate) }))
      .sort(compareScored)

    if (plan.ranked.length === 0) {
      plan.status = input.tasks.length === 0 ? "no-tasks" : openTasks.length === 0 ? "all-done" : "covered"
    } else {
      const hasUsableTime = day.slots.some((slot) => slot.end - slot.start >= settings.minBlockMinutes)
      placeSessions(plan, day, remaining)
      plan.status =
        day.limitLeft <= 0 ? "limit-reached" : !hasUsableTime && plan.suggestions.length === 0 ? "no-time" : "ok"
    }

    // 6. Needs attention.
    plan.warnings = buildWarnings({ plan, today, openTasks, settings })
    return plan
  }

  // 5. Place study sessions for the ranked tasks. Updates `remaining` with what was planned.
  function placeSessions(plan: DailyPlan, day: DayAvailability, remaining: Map<string, number>) {
    const dayEnd = toMinutes(settings.dayEnd)
    let budget = day.budget

    for (const scored of plan.ranked) {
      const { task } = scored
      const left0 = remaining.get(task.id)!
      const daysLeft = Math.max(scored.daysLeft, 0)
      // Work due later today has to finish before its due time.
      const cutoff = task.dueDate === plan.date && task.dueTime ? Math.min(dayEnd, toMinutes(task.dueTime)) : dayEnd
      // What later days (before the deadline) could still take on.
      const laterCapacity = daysLeft <= 1 ? 0 : capacityBetween(addDays(plan.date, 1), addDays(task.dueDate, -1))
      const target = dailyTarget(left0, daysLeft, laterCapacity, settings)
      const reasons = reasonsOf(scored)
      if (target < left0) reasons.push(`Spread over several days (${formatDuration(left0)} left)`)
      const learned = estimates.get(task.id)?.learned
      if (learned) reasons.push(learned.reason)

      let left = target
      let scheduled = 0
      let hitLimit = false
      while (left > 0) {
        // The shortest block worth placing: a full minimum block, or what's left if less.
        const smallest = Math.min(settings.minBlockMinutes, roundUp(left, 5))
        const ideal = idealBlock(left, settings)
        const wanted = Math.min(ideal, roundDown(budget, 5))
        if (wanted < smallest) {
          hitLimit = true
          break
        }
        // The earliest free block with room for at least the smallest useful block
        // (outside times the student usually misses, if there's another choice).
        const pick = pickSlot(day.slots, smallest, cutoff, avoidOn(plan.date))
        if (!pick) break
        const { slot, start, avoided } = pick
        const space = roundDown(pick.end - start, 5)
        // Adapt to the real gap: a 45-minute gap gets a 45-minute session.
        const length = Math.min(wanted, space)
        if (start > slot.start) {
          // Placed later in the block: the free time before it stays usable.
          const before = start - settings.breakMinutes
          if (before > slot.start) day.slots.splice(day.slots.indexOf(slot), 0, { start: slot.start, end: before })
        }
        plan.suggestions.push({
          id: `${task.id}@${plan.date}T${fromMinutes(start)}`,
          taskId: task.id,
          date: plan.date,
          startTime: fromMinutes(start),
          endTime: fromMinutes(start + length),
          status: "suggested",
          score: scored.score,
          reasons: [...reasons, ...(avoided ? [avoided] : []), placementReason(length, ideal, space)],
        })
        // Use up the block, plus a break before any next study block.
        slot.start = Math.min(slot.end, start + length + settings.breakMinutes)
        left = Math.max(0, left - length)
        budget -= length
        scheduled += length
      }

      remaining.set(task.id, left0 - scheduled)
      if (left > 0) plan.unscheduled.push(unscheduledEntry(task, left, scheduled, hitLimit, day, cutoff, scored))
    }

    plan.suggestions.sort((a, b) => a.startTime.localeCompare(b.startTime))
    plan.studyMinutes = day.bookedStudyMinutes + (day.budget - budget)
  }

  // Times to use last on a date. On today, the next hour is never avoided: the
  // student is here now, and "What should I do now?" should use it.
  function avoidOn(date: string): { start: number; end: number; reason: string }[] {
    const avoid = input.learned?.avoidTimes ?? []
    if (date !== today) return avoid
    const here = { start: nowMinutes, end: nowMinutes + 60 }
    return avoid.flatMap((a) =>
      [
        { ...a, end: Math.min(a.end, here.start) },
        { ...a, start: Math.max(a.start, here.end) },
      ].filter((part) => part.end > part.start)
    )
  }

  function unscheduledEntry(
    task: Task,
    left: number,
    scheduled: number,
    hitLimit: boolean,
    day: DayAvailability,
    cutoff: number,
    scored: ScoredTask
  ): UnscheduledTask {
    // Out of budget while usable free time remains = the daily limit stopped it.
    // Otherwise the day simply ran out of free time.
    const freeTimeLeft = day.slots.some(
      (slot) => Math.min(slot.end, cutoff) - slot.start >= Math.min(left, settings.minBlockMinutes)
    )
    return {
      taskId: task.id,
      missingMinutes: left,
      scheduledMinutes: scheduled,
      reason: hitLimit && freeTimeLeft ? "daily-limit" : "no-time",
      atRisk: scored.daysLeft <= 2,
    }
  }

  // Plans are simulated day by day from today, and cached.
  const plans = new Map<string, DailyPlan>()
  const simulated = baselineRemaining()
  let simulatedThrough = addDays(today, -1)

  function planFor(date: string): DailyPlan {
    const cached = plans.get(date)
    if (cached) return cached
    let plan: DailyPlan
    if (date < today) {
      plan = pastPlan(date)
    } else if (daysBetween(fromDateKey(today), fromDateKey(date)) > settings.lookaheadDays) {
      // Far ahead: planned on its own, from today's view of the remaining work.
      plan = planDay(date, baselineRemaining())
    } else {
      while (simulatedThrough < date) {
        simulatedThrough = addDays(simulatedThrough, 1)
        plans.set(simulatedThrough, planDay(simulatedThrough, simulated))
      }
      plan = plans.get(date)!
    }
    plans.set(date, plan)
    return plan
  }

  function pastPlan(date: string): DailyPlan {
    const day = dayAvailability(date, events, commitments, now, settings)
    return {
      date,
      status: "past",
      suggestions: [],
      existingSessions: existingSessionsOn(day.items, date, today, nowMinutes),
      unscheduled: [],
      skippedTaskIds: input.skipped?.[date] ?? [],
      ranked: [],
      available: [],
      studyMinutes: day.bookedStudyMinutes,
      studyLimit: settings.maxStudyMinutesPerDay,
      freeMinutes: 0,
      warnings: [],
    }
  }

  return { settings, planFor, estimateOf: learnedEstimate }
}

// One-date convenience (tests, and anywhere only a single day is needed).
export type PlanInput = Omit<PlannerInput, "skipped"> & {
  date: string
  // Tasks the student removed from this date's plan.
  skippedTaskIds?: string[]
}

export function generatePlan({ date, skippedTaskIds, ...input }: PlanInput): DailyPlan {
  return createPlanner({ ...input, skipped: skippedTaskIds ? { [date]: skippedTaskIds } : undefined }).planFor(date)
}

// Study sessions already on the calendar for the day, linked to a task. One that
// ended without being marked done is "missed" (never marked done automatically).
function existingSessionsOn(items: CalendarEvent[], date: string, today: string, nowMinutes: number): StudySession[] {
  return items
    .filter((e) => e.type === "study" && e.taskId)
    .sort(byStart)
    .map((e) => ({
      id: e.id,
      eventId: e.id,
      taskId: e.taskId!,
      date,
      startTime: e.startTime,
      endTime: e.endTime,
      status: e.completed ? "completed" : isMissed(e, today, nowMinutes) ? "missed" : "scheduled",
      ...(e.completed && e.completedMinutes ? { completedMinutes: workedMinutes(e) } : {}),
    }))
}

// Where to put the next session: the earliest free block with room for
// `smallest` minutes. With times to avoid, the earliest room OUTSIDE them wins
// if there is any (it may be later in a block); otherwise the earliest room at
// all, so avoided times are used last, never blocked. `avoided` is the reason
// when avoiding changed the choice.
export function pickSlot(
  slots: { start: number; end: number }[],
  smallest: number,
  cutoff: number,
  avoid: { start: number; end: number; reason: string }[]
): { slot: { start: number; end: number }; start: number; end: number; avoided?: string } | null {
  const fits = (from: number, to: number) => roundDown(to - from, 5) >= smallest
  const earliest = slots.find((s) => fits(s.start, Math.min(s.end, cutoff)))
  if (!earliest) return null
  const plain = { slot: earliest, start: earliest.start, end: Math.min(earliest.end, cutoff) }
  if (avoid.length === 0) return plain
  const inAvoided = (from: number, to: number) => avoid.find((a) => from < a.end && a.start < to)
  for (const slot of slots) {
    // The block minus the avoided times, in order.
    let parts = [{ start: slot.start, end: Math.min(slot.end, cutoff) }]
    for (const a of avoid) {
      parts = parts.flatMap((p) =>
        p.end <= a.start || a.end <= p.start
          ? [p]
          : [
              { start: p.start, end: a.start },
              { start: a.end, end: p.end },
            ].filter((x) => x.end > x.start)
      )
    }
    parts.sort((a, b) => a.start - b.start)
    const part = parts.find((p) => fits(p.start, p.end))
    if (!part) continue
    const changed = slot !== plain.slot || part.start !== plain.start
    const skippedOver = changed ? inAvoided(plain.start, plain.start + smallest) : undefined
    return { slot, start: part.start, end: part.end, ...(skippedOver ? { avoided: skippedOver.reason } : {}) }
  }
  return plain
}

// Why the session has the length it has (the last "Why this?" reason).
function placementReason(length: number, ideal: number, space: number): string {
  if (length >= ideal) return "Fits your available time"
  if (space <= length) return `Shortened to fit a ${formatDuration(length)} gap`
  return "Shortened to stay within your daily study limit"
}

// How much of a task's remaining work to aim for on one day.
// - Due today or tomorrow (or overdue): all of it.
// - Otherwise an even share over the days left (at least one minimum block,
//   so progress actually happens)…
// - …but more if the later days before the deadline can't hold the rest.
export function dailyTarget(
  remaining: number,
  daysLeft: number,
  laterCapacity: number,
  settings: Pick<PlannerSettings, "minBlockMinutes">
): number {
  if (daysLeft <= 1) return remaining
  const evenShare = Math.max(roundUp(remaining / daysLeft, 15), settings.minBlockMinutes)
  const catchUp = remaining - laterCapacity
  return Math.min(remaining, Math.max(evenShare, catchUp))
}

// The block length we'd like for `left` minutes of work.
// With a preferred block length (from the student's preferences), work is done
// in blocks of that length, with a shorter last block (90 min at 60 -> 60 + 30),
// unless the remainder would be shorter than a minimum block (70 at 60 -> 70).
// Without one, anything longer than the maximum is split into equal blocks (3h -> 2 x 90 min).
// Never longer than the maximum continuous study time.
function idealBlock(left: number, settings: PlannerSettings): number {
  return Math.min(settings.maxBlockMinutes, idealLength(left, settings))
}

function idealLength(left: number, settings: PlannerSettings): number {
  const preferred = settings.preferredBlockMinutes
  if (preferred) {
    if (left <= preferred) return roundUp(left, 5)
    if (left - preferred < settings.minBlockMinutes && left <= settings.maxBlockMinutes) return roundUp(left, 5)
    return preferred
  }
  if (left <= settings.maxBlockMinutes) return roundUp(left, 5)
  const blocks = Math.ceil(left / settings.maxBlockMinutes)
  return roundUp(left / blocks, 15)
}
