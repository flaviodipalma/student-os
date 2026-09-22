"use client"

import { useMemo } from "react"
import { useAppStore } from "@/lib/app-store"
import { useNow } from "@/lib/clock"
import { generatePlan, type DailyPlan, type StudySession } from "@/lib/planner"

// Connects the planner (pure logic in src/lib/planner) to the student's saved data.
//
//   database -> tasks + events + study sessions -> generatePlan -> suggestions
//
// usePlan(date) is used by both the Planner page and the Dashboard, so they
// always agree. Suggestions themselves aren't stored; they're recalculated from
// the saved data. What the student does with them is stored as a study session:
//   accept -> scheduled, mark done -> completed, remove -> skipped.

export function usePlan(date: string): DailyPlan {
  const { tasks, calendarItems, studySessions } = useAppStore()
  const now = useNow()

  return useMemo(() => {
    const skippedTaskIds = studySessions
      .filter((session) => session.status === "skipped" && session.date === date)
      .map((session) => session.taskId)
    // calendarItems = events plus the student's scheduled/completed study sessions.
    return generatePlan({ date, tasks, events: calendarItems, now, skippedTaskIds })
  }, [date, tasks, calendarItems, studySessions, now])
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
