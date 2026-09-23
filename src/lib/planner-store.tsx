"use client"

import { createContext, use, useMemo } from "react"
import { useAppStore } from "@/lib/app-store"
import { useNow } from "@/lib/clock"
import { createPlanner, type DailyPlan, type Planner, type StudySession } from "@/lib/planner"
import { plannerInputFor } from "@/lib/planner-input"

// Connects the planner (pure logic in src/lib/planner) to the student's saved data.
//
//   database -> tasks + events + study sessions + weekly commitments
//            + the student's study preferences -> createPlanner -> DailyPlan per date
//
// One planner is shared by every page (PlannerProvider), so the Dashboard and
// the Planner page read the very same DailyPlan. It's rebuilt only when the
// data, preferences or the current minute change; plans are cached per date.
// Recommendations themselves aren't stored. What the student does with them is
// stored as a study session: accept -> scheduled, mark done -> completed,
// remove -> skipped.

const PlannerContext = createContext<Planner | null>(null)

export function PlannerProvider({ children }: { children: React.ReactNode }) {
  const { tasks, courses, events, studySessions, preferences, recurringCommitments, externalEvents, timeZone } = useAppStore()
  const now = useNow()
  // The clock ticks every 30 seconds; the plan only needs to move on each minute.
  const minute = Math.floor(now.getTime() / 60_000)

  const planner = useMemo(
    () =>
      createPlanner(
        plannerInputFor(
          { tasks, courses, events, studySessions, preferences, recurringCommitments, externalEvents, timeZone },
          new Date(minute * 60_000)
        )
      ),
    [tasks, courses, events, studySessions, recurringCommitments, preferences, externalEvents, timeZone, minute]
  )

  return <PlannerContext value={planner}>{children}</PlannerContext>
}

// The plan for one date. Same object for every component asking for that date.
export function usePlan(date: string): DailyPlan {
  const planner = use(PlannerContext)
  if (!planner) throw new Error("usePlan must be used inside PlannerProvider")
  return useMemo(() => planner.planFor(date), [planner, date])
}

export function usePlanActions() {
  const { studySessions, addStudySession, updateStudySession, deleteStudySession } = useAppStore()

  // A planner session that exists on the calendar has eventId = its study session id.
  const store = (session: StudySession, status: "scheduled" | "completed" | "skipped") =>
    addStudySession({
      taskId: session.taskId,
      date: session.date,
      startTime: session.startTime,
      endTime: session.endTime,
      status,
    })

  return {
    // Put a suggestion on the calendar.
    accept: (session: StudySession) => store(session, "scheduled"),

    // Mark a session done (a suggestion is saved as done straight away).
    complete: (session: StudySession) =>
      session.eventId ? updateStudySession(session.eventId, { status: "completed" }) : store(session, "completed"),

    undoComplete: (session: StudySession) =>
      session.eventId && updateStudySession(session.eventId, { status: "scheduled" }),

    // Drop a session from this day's plan; the task isn't suggested again that day.
    remove: (session: StudySession) =>
      session.eventId ? updateStudySession(session.eventId, { status: "skipped" }) : store(session, "skipped"),

    // Bring a removed task back into that day's plan.
    restore: (taskId: string, date: string) => {
      for (const session of studySessions) {
        if (session.taskId === taskId && session.date === date && session.status === "skipped") {
          deleteStudySession(session.id)
        }
      }
    },
  }
}
