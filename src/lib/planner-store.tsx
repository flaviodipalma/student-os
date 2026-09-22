"use client"

import { createContext, use, useMemo, useState } from "react"
import { useNow } from "@/lib/clock"
import { getCourse } from "@/lib/data/courses"
import { useEvents } from "@/lib/event-store"
import { generatePlan, type DailyPlan, type StudySession } from "@/lib/planner"
import { useTasks } from "@/lib/task-store"
import type { Task } from "@/lib/types"

// Connects the planner (pure logic in src/lib/planner) to the app's shared state.
//
// usePlan(date) runs the planner on the current tasks and events, so the Planner
// page and the Dashboard always show the same plan. The only planner-specific state
// kept here is which tasks the student removed from a day's plan.
//
// Accepting a suggestion turns it into a calendar event (type "study", linked to
// the task). The task itself never becomes an event.

type PlannerStore = {
  skipped: Set<string>
  setSkipped: (update: (prev: Set<string>) => Set<string>) => void
}

const PlannerContext = createContext<PlannerStore | null>(null)

const skipKey = (taskId: string, date: string) => `${taskId}|${date}`

export function PlannerStoreProvider({ children }: { children: React.ReactNode }) {
  const [skipped, setSkipped] = useState<Set<string>>(() => new Set())
  return <PlannerContext value={{ skipped, setSkipped }}>{children}</PlannerContext>
}

function usePlannerStore(): PlannerStore {
  const store = use(PlannerContext)
  if (!store) throw new Error("Planner hooks must be used inside PlannerStoreProvider")
  return store
}

export function usePlan(date: string): DailyPlan {
  const { tasks } = useTasks()
  const { events } = useEvents()
  const now = useNow()
  const { skipped } = usePlannerStore()

  return useMemo(() => {
    const skippedTaskIds = [...skipped]
      .filter((key) => key.endsWith(`|${date}`))
      .map((key) => key.slice(0, key.indexOf("|")))
    return generatePlan({ date, tasks, events, now, skippedTaskIds })
  }, [date, tasks, events, now, skipped])
}

// The title a study session gets on the calendar.
export function sessionTitle(task: Task): string {
  const code = getCourse(task.courseId)?.code
  return `Study — ${code ? `${code} ` : ""}${task.title}`
}

export function usePlanActions() {
  const { addEvent, updateEvent, deleteEvent } = useEvents()
  const { setSkipped } = usePlannerStore()

  const skip = (taskId: string, date: string) =>
    setSkipped((prev) => new Set(prev).add(skipKey(taskId, date)))

  const toEvent = (session: StudySession, task: Task, completed: boolean) =>
    addEvent({
      title: sessionTitle(task),
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      type: "study",
      courseId: task.courseId,
      taskId: task.id,
      completed: completed || undefined,
    })

  return {
    // Put a suggestion on the calendar.
    accept: (session: StudySession, task: Task) => toEvent(session, task, false),

    // Mark a session done (a suggestion is added to the calendar as done).
    complete: (session: StudySession, task: Task) =>
      session.eventId ? updateEvent(session.eventId, { completed: true }) : toEvent(session, task, true),

    undoComplete: (session: StudySession) => session.eventId && updateEvent(session.eventId, { completed: false }),

    // Drop a session from this day's plan. The task isn't suggested again that day.
    remove: (session: StudySession) => {
      if (session.eventId) deleteEvent(session.eventId)
      skip(session.taskId, session.date)
    },

    restore: (taskId: string, date: string) =>
      setSkipped((prev) => {
        const next = new Set(prev)
        next.delete(skipKey(taskId, date))
        return next
      }),
  }
}
