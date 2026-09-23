import { addDays } from "@/lib/format"
import type { CalendarEvent, EventInput, RecurringCommitmentInput } from "@/lib/types"

// DEVELOPMENT SEED DATA. Only `npm run db:seed` uses this, for a dev test account.
//
// The student's regular week (classes, practice, work shifts) becomes weekly
// commitments (seedWeeklyCommitments); the one-off events around today stay events.

type WeeklyEvent = Omit<EventInput, "date">

// 0 = Sunday … 6 = Saturday
const weeklySchedule: Record<number, WeeklyEvent[]> = {
  0: [
    { title: "Call home", startTime: "17:00", endTime: "17:30", type: "personal" },
  ],
  1: [
    { title: "PSY101 Lecture", startTime: "09:00", endTime: "09:50", type: "class", courseId: "psy101", description: "Buckman Hall 120" },
    { title: "BIO101 Lecture", startTime: "11:00", endTime: "11:50", type: "class", courseId: "bio101", description: "Science Center 101" },
    { title: "Soccer Practice", startTime: "15:30", endTime: "17:30", type: "sports", description: "North Field" },
    { title: "Library desk shift", startTime: "18:30", endTime: "21:00", type: "work", description: "Main library, front desk" },
  ],
  2: [
    { title: "Soccer Practice", startTime: "10:30", endTime: "13:00", type: "sports", description: "North Field" },
    { title: "CSC215 Class", startTime: "14:00", endTime: "15:15", type: "class", courseId: "csc215", description: "Tator Hall 202" },
    { title: "SER225 Class", startTime: "16:00", endTime: "17:15", type: "class", courseId: "ser225", description: "Echlin Center 205" },
  ],
  3: [
    { title: "PSY101 Lecture", startTime: "09:00", endTime: "09:50", type: "class", courseId: "psy101", description: "Buckman Hall 120" },
    { title: "BIO101 Lecture", startTime: "11:00", endTime: "11:50", type: "class", courseId: "bio101", description: "Science Center 101" },
    { title: "Library desk shift", startTime: "13:00", endTime: "16:00", type: "work", description: "Main library, front desk" },
    { title: "Soccer Practice", startTime: "16:30", endTime: "18:30", type: "sports", description: "North Field" },
  ],
  4: [
    { title: "BIO101 Lab", startTime: "09:00", endTime: "11:50", type: "class", courseId: "bio101", description: "Science Center, Lab B" },
    { title: "CSC215 Class", startTime: "14:00", endTime: "15:15", type: "class", courseId: "csc215", description: "Tator Hall 202" },
    { title: "SER225 Class", startTime: "16:00", endTime: "17:15", type: "class", courseId: "ser225", description: "Echlin Center 205" },
    { title: "Soccer Practice", startTime: "17:45", endTime: "19:15", type: "sports", description: "North Field" },
  ],
  5: [
    { title: "PSY101 Lecture", startTime: "09:00", endTime: "09:50", type: "class", courseId: "psy101", description: "Buckman Hall 120" },
    { title: "Soccer Practice", startTime: "10:30", endTime: "12:30", type: "sports", description: "North Field" },
    { title: "Library desk shift", startTime: "14:00", endTime: "17:00", type: "work", description: "Main library, front desk" },
  ],
  6: [
    { title: "Soccer Game", startTime: "11:00", endTime: "13:30", type: "sports", description: "Home game vs. Bentley" },
  ],
}

// The regular week as weekly commitments: one per activity and time, with its days.
export function seedWeeklyCommitments(): RecurringCommitmentInput[] {
  const byKey = new Map<string, RecurringCommitmentInput>()
  for (const [day, entries] of Object.entries(weeklySchedule)) {
    for (const entry of entries) {
      const key = `${entry.title}|${entry.startTime}|${entry.endTime}`
      const existing = byKey.get(key)
      if (existing) existing.daysOfWeek.push(Number(day))
      else
        byKey.set(key, {
          title: entry.title,
          daysOfWeek: [Number(day)],
          startTime: entry.startTime,
          endTime: entry.endTime,
          type: entry.type,
        })
    }
  }
  return [...byKey.values()]
}

export function buildMockEvents(today: string): CalendarEvent[] {
  const events: CalendarEvent[] = []

  // One-off events around today, including study sessions already booked for
  // specific tasks. (Today's work is left for the Planner to suggest.)
  const day = (offset: number) => addDays(today, offset)
  events.push(
    {
      id: "dinner-roommates",
      title: "Dinner with roommates",
      date: day(0),
      startTime: "19:00",
      endTime: "20:00",
      type: "personal",
      description: "Commons dining hall",
    },
    {
      id: "study-ser225-ch4",
      title: "Study — SER225 Reading",
      date: day(1),
      startTime: "12:00",
      endTime: "12:45",
      type: "study",
      courseId: "ser225",
      taskId: "ser225-ch4",
    },
    {
      id: "study-psy101-quiz3",
      title: "Study — PSY101 Quiz 3 review",
      date: day(1),
      startTime: "20:00",
      endTime: "20:45",
      type: "study",
      courseId: "psy101",
      taskId: "psy101-quiz3-review",
    },
    {
      id: "study-ser225-exam1",
      title: "Study — SER225 Exam 1 prep",
      date: day(2),
      startTime: "19:30",
      endTime: "21:00",
      type: "study",
      courseId: "ser225",
      taskId: "ser225-exam1",
    },
    {
      id: "study-psy101-ch5",
      title: "Study — PSY101 Chapter 5",
      date: day(-1),
      startTime: "19:00",
      endTime: "20:00",
      type: "study",
      courseId: "psy101",
      taskId: "psy101-ch5",
    }
  )

  return events
}
