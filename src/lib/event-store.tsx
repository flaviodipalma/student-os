"use client"

import { useAppStore } from "@/lib/app-store"

// Calendar data from the shared app store (loaded from the database).
// `events` includes study sessions shown as study blocks (they carry a sessionId);
// the add/update/delete functions below are for real events only.
export function useEvents() {
  const { calendarItems, addEvent, updateEvent, deleteEvent } = useAppStore()
  return { events: calendarItems, addEvent, updateEvent, deleteEvent }
}

export function useStudySessions() {
  const { studySessions, addStudySession, updateStudySession, deleteStudySession } = useAppStore()
  return { studySessions, addStudySession, updateStudySession, deleteStudySession }
}
