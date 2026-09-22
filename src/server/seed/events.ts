import { addDays, fromDateKey } from "@/lib/format"
import type { CalendarEvent, EventInput } from "@/lib/types"

// DEVELOPMENT SEED DATA. Only `npm run db:seed` uses this, for a dev test account.
//
// The student's regular week (classes, practice, work shifts) is written out
// as real, dated events for a few weeks around today. There are no recurring
// events yet; each event is a separate item, like a database row.

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

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

export function buildMockEvents(today: string): CalendarEvent[] {
  const events: CalendarEvent[] = []

  // The regular week, from two weeks ago to four weeks ahead.
  for (let offset = -14; offset <= 28; offset++) {
    const date = addDays(today, offset)
    for (const event of weeklySchedule[fromDateKey(date).getDay()]) {
      events.push({ ...event, id: `${slug(event.title)}-${date}`, date })
    }
  }

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
