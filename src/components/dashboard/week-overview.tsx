"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useCourses } from "@/lib/course-store"
import { useEvents } from "@/lib/event-store"
import { useAppStore } from "@/lib/app-store"
import { busyRanges, durationMinutes, toMinutes } from "@/lib/events"
import { addDays, formatRelativeDay, formatWeekday, fromDateKey } from "@/lib/format"
import { useTasks } from "@/lib/task-store"
import { daysUntilDue, upcomingDeadlines } from "@/lib/tasks"
import type { CalendarEvent, Task } from "@/lib/types"
import { cn } from "@/lib/utils"

type WeekDay = {
  date: string
  shortLabel: string
  longLabel: string
  isToday: boolean
  fixedHours: number
  studyHours: number
  freeHours: number
  deadlines: string[]
}

// A day's hours, worked out from its calendar events. Free time is counted inside
// the student's study window (from their preferences).
function loadOf(events: CalendarEvent[], window: { start: number; end: number }) {
  const sum = (list: CalendarEvent[]) => list.reduce((total, e) => total + durationMinutes(e), 0) / 60
  const busyInWindow = busyRanges(events).reduce(
    (total, [start, end]) => total + Math.max(0, Math.min(end, window.end) - Math.max(start, window.start)),
    0
  )
  return {
    fixedHours: sum(events.filter((e) => e.type !== "study")),
    studyHours: sum(events.filter((e) => e.type === "study")),
    freeHours: (window.end - window.start - busyInWindow) / 60,
  }
}

// Rounds to the nearest half hour: 3.58 -> "3.5h"
function hours(value: number): string {
  return `${Math.round(value * 2) / 2}h`
}

const CHART_HEIGHT_PX = 112

function summarize(day: WeekDay): string {
  const due = day.deadlines.length > 0 ? ` Due: ${day.deadlines.join(", ")}.` : ""
  return `${day.longLabel}: ${hours(day.fixedHours)} commitments, ${hours(day.studyHours)} study, ${hours(day.freeHours)} free.${due}`
}

export function WeekOverview({ className }: { className?: string }) {
  const { tasks, today } = useTasks()
  const { scheduleOn } = useEvents()
  const { getCourse } = useCourses()
  const { preferences } = useAppStore()
  const studyWindow = { start: toMinutes(preferences.studyStart), end: toMinutes(preferences.studyEnd) }
  const label = (task: Task) => `${getCourse(task.courseId)?.code ?? ""} ${task.title}`.trim()

  // Open graded work due in the next 7 days.
  const thisWeek = upcomingDeadlines(tasks, today).filter((task) => daysUntilDue(task, today) < 7)
  const exams = thisWeek.filter((task) => task.type === "exam" || task.type === "quiz")
  const days: WeekDay[] = Array.from({ length: 7 }, (_, offset) => {
    const date = addDays(today, offset)
    return {
      date,
      shortLabel: offset === 0 ? "Today" : formatWeekday(fromDateKey(date), "short"),
      longLabel: offset === 0 ? "Today" : formatRelativeDay(fromDateKey(date), fromDateKey(today)),
      isToday: offset === 0,
      ...loadOf(scheduleOn(date), studyWindow),
      deadlines: thisWeek.filter((task) => task.dueDate === date).map(label),
    }
  })

  const stats = {
    assignmentsDue: thisWeek.length - exams.length,
    examsAndQuizzes: exams.length,
    studyHours: days.reduce((sum, day) => sum + day.studyHours, 0),
    freeHours: days.reduce((sum, day) => sum + day.freeHours, 0),
  }
  const committedHours = days.reduce((sum, day) => sum + day.fixedHours + day.studyHours, 0)
  const verdict =
    committedHours >= 40 || exams.length >= 2
      ? "Busy week ahead"
      : committedHours >= 25
        ? "A steady week"
        : "A light week"
  const keyDates = exams.map((task) => ({
    id: task.id,
    label: label(task),
    dayLabel: formatRelativeDay(fromDateKey(task.dueDate), fromDateKey(today)),
  }))

  const totals = days.map((day) => day.fixedHours + day.studyHours)
  const scaleMax = Math.max(...totals, 1)
  const busiestIndex = totals.indexOf(Math.max(...totals))

  const tiles = [
    { label: "Assignments due", value: String(stats.assignmentsDue) },
    { label: "Exams & quizzes", value: String(stats.examsAndQuizzes) },
    { label: "Study scheduled", value: hours(stats.studyHours) },
    { label: "Free time", value: hours(stats.freeHours) },
  ]

  return (
    <Card className={className}>
      <CardHeader>
        <CardDescription>Next 7 days</CardDescription>
        <CardTitle className="text-lg font-semibold">{verdict}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          {tiles.map((tile) => (
            <div key={tile.label}>
              <dt className="text-xs text-muted-foreground">{tile.label}</dt>
              <dd className="mt-0.5 text-2xl font-semibold">{tile.value}</dd>
            </div>
          ))}
        </dl>

        <figure>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <figcaption className="text-sm font-medium">Committed hours per day</figcaption>
            <ul aria-label="Legend" className="flex gap-3 text-xs text-muted-foreground">
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm bg-event-class" />
                Commitments
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-sm bg-primary" />
                Study
              </li>
              <li className="inline-flex items-center gap-1.5">
                <span aria-hidden className="size-1.5 rounded-full bg-foreground" />
                Due
              </li>
            </ul>
          </div>

          <div className="mt-4 grid grid-cols-7 gap-1 border-b border-border">
            {days.map((day, index) => {
              const segments = [
                { hours: day.studyHours, className: "bg-primary" },
                { hours: day.fixedHours, className: "bg-event-class" },
              ].filter((segment) => segment.hours > 0)
              return (
                <div
                  key={day.date}
                  tabIndex={0}
                  role="img"
                  aria-label={summarize(day)}
                  className="group relative flex flex-col items-center justify-end rounded-md outline-none hover:bg-muted/60 focus-visible:bg-muted/60"
                  style={{ height: CHART_HEIGHT_PX + 20 }}
                >
                  {index === busiestIndex && (
                    <span className="mb-1 text-[11px] font-medium text-muted-foreground">
                      {hours(totals[index])}
                    </span>
                  )}
                  <div className="flex w-full max-w-6 flex-col gap-[2px]">
                    {segments.map((segment, i) => (
                      <div
                        key={segment.className}
                        className={cn(segment.className, i === 0 && "rounded-t-[4px]")}
                        style={{ height: (segment.hours / scaleMax) * CHART_HEIGHT_PX }}
                      />
                    ))}
                  </div>
                  {/* Hover / focus tooltip */}
                  <div
                    aria-hidden
                    className={cn(
                      "pointer-events-none absolute bottom-full z-10 mb-1 hidden w-44 rounded-lg bg-popover p-2.5 text-xs text-popover-foreground shadow-md ring-1 ring-border group-hover:block group-focus-visible:block",
                      // Keep the tooltip inside the card at the edges.
                      index < 2 ? "left-0" : index > 4 ? "right-0" : "left-1/2 -translate-x-1/2"
                    )}
                  >
                    <p className="font-medium">{day.longLabel}</p>
                    <p className="mt-1 text-muted-foreground">
                      {hours(day.fixedHours)} commitments · {hours(day.studyHours)} study · {hours(day.freeHours)} free
                    </p>
                    {day.deadlines.length > 0 && (
                      <p className="mt-1">Due: {day.deadlines.join(", ")}</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <div aria-hidden className="mt-2 grid grid-cols-7 gap-1 text-center text-xs">
            {days.map((day) => (
              <div key={day.date}>
                <p className={cn(day.isToday ? "font-semibold" : "text-muted-foreground")}>
                  {day.shortLabel}
                </p>
                <p className="mt-1 flex h-1.5 justify-center gap-0.5">
                  {day.deadlines.map((title) => (
                    <span key={title} className="size-1.5 rounded-full bg-foreground" />
                  ))}
                </p>
              </div>
            ))}
          </div>
        </figure>

        {keyDates.length > 0 && (
          <div>
            <h3 className="text-sm font-medium">Major deadlines</h3>
            <ul className="mt-2 flex flex-wrap gap-2">
              {keyDates.map((date) => (
                <li key={date.id} className="rounded-lg bg-muted px-2.5 py-1 text-sm">
                  <span className="font-medium">{date.label}</span>
                  <span className="text-muted-foreground"> · {date.dayLabel}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
