import { toDateKey } from "@/lib/format"
import type { DayLoad, ScheduleBlock, Student } from "@/lib/types"

// Fictional schedule data (today's timeline and the week's hours), used until the
// calendar and planner exist. Times are built relative to `now` so it always looks current.

export const student: Student = { firstName: "Flavio" }

// Hours of the day that are realistically available (outside sleep, meals, getting around).
const AVAILABLE_HOURS = 12

// Typical fixed/study hours per weekday (0 = Sunday), used for the rest of the week.
const weeklyTemplate: Record<number, { fixed: number; study: number }> = {
  0: { fixed: 0, study: 3 },
  1: { fixed: 4.5, study: 2.5 },
  2: { fixed: 4.5, study: 2.5 },
  3: { fixed: 4.5, study: 3 },
  4: { fixed: 5, study: 2 },
  5: { fixed: 3, study: 1.5 },
  6: { fixed: 2.5, study: 1 },
}

function dayAt(now: Date, dayOffset: number, time: string): Date {
  const [hours, minutes] = time.split(":").map(Number)
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hours, minutes)
}

function buildSchedule(now: Date): ScheduleBlock[] {
  const at = (time: string) => dayAt(now, 0, time)
  return [
    { id: "s1", kind: "fixed", category: "Class", title: "PSY101 Lecture", courseId: "psy101", location: "Buckman Hall 120", start: at("09:00"), end: at("09:50") },
    { id: "s2", kind: "fixed", category: "Practice", title: "Soccer Practice", location: "North Field", start: at("10:30"), end: at("12:00") },
    { id: "s3", kind: "free", title: "Lunch", start: at("12:00"), end: at("13:00") },
    { id: "s4", kind: "study", title: "SER225 Reading: Chapter 4", courseId: "ser225", location: "Library", start: at("13:00"), end: at("13:45") },
    { id: "s5", kind: "fixed", category: "Class", title: "CSC215 Class", courseId: "csc215", location: "Tator Hall 202", start: at("14:00"), end: at("15:15") },
    { id: "s6", kind: "free", title: "Free time", start: at("15:15"), end: at("16:00") },
    { id: "s7", kind: "study", title: "CSC215 Assignment #2", courseId: "csc215", location: "Library, 2nd floor", start: at("16:00"), end: at("17:30") },
    { id: "s8", kind: "free", title: "Dinner", start: at("17:30"), end: at("18:30") },
    { id: "s9", kind: "study", title: "PSY101 Quiz 3 review", courseId: "psy101", start: at("19:00"), end: at("19:45") },
  ]
}

function hoursOf(blocks: ScheduleBlock[], kind: ScheduleBlock["kind"]): number {
  return blocks
    .filter((block) => block.kind === kind)
    .reduce((sum, block) => sum + (block.end.getTime() - block.start.getTime()) / 3_600_000, 0)
}

// The next 7 days, starting today. Today's numbers come from today's actual schedule.
function buildWeek(now: Date, schedule: ScheduleBlock[]): DayLoad[] {
  return Array.from({ length: 7 }, (_, offset) => {
    const date = dayAt(now, offset, "00:00")
    const { fixed, study } =
      offset === 0
        ? { fixed: hoursOf(schedule, "fixed"), study: hoursOf(schedule, "study") }
        : weeklyTemplate[date.getDay()]
    return {
      date: toDateKey(date),
      fixedHours: fixed,
      studyHours: study,
      freeHours: Math.max(0, AVAILABLE_HOURS - fixed - study),
    }
  })
}

export function getScheduleData(now: Date) {
  const schedule = buildSchedule(now)
  return { student, schedule, week: buildWeek(now, schedule) }
}
