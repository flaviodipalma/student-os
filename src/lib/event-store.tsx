"use client"

import { useAppStore } from "@/lib/app-store"

// Calendar data from the shared app store (loaded from the database).
//
// scheduleBetween(from, to) / scheduleOn(date) give everything on the student's
// schedule for those days: events, study sessions (shown as study blocks, with a
// sessionId) and weekly commitment occurrences (with a commitmentId). The
// Calendar, Dashboard and Planner page all read from here.
// The add/update/delete functions below are for one-time events only.
export function useEvents() {
  const { scheduleBetween, addEvent, updateEvent, deleteEvent } = useAppStore()
  return {
    scheduleBetween,
    scheduleOn: (date: string) => scheduleBetween(date, date),
    addEvent,
    updateEvent,
    deleteEvent,
  }
}

// Weekly commitments (repeating events): stored once as a rule.
export function useCommitments() {
  const { recurringCommitments, getCommitment, addCommitment, updateCommitment, deleteCommitment } = useAppStore()
  return { commitments: recurringCommitments, getCommitment, addCommitment, updateCommitment, deleteCommitment }
}

export function useStudySessions() {
  const { studySessions, addStudySession, updateStudySession, deleteStudySession } = useAppStore()
  return { studySessions, addStudySession, updateStudySession, deleteStudySession }
}
