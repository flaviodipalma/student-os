import type { Metadata } from "next"
import { connection } from "next/server"
import { DailyProgress } from "@/components/dashboard/daily-progress"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PriorityTasks } from "@/components/dashboard/priority-tasks"
import { TodaySchedule, type ScheduleItem } from "@/components/dashboard/today-schedule"
import { UpcomingDeadlines } from "@/components/dashboard/upcoming-deadlines"
import { WeekOverview, type WeekDayLoad } from "@/components/dashboard/week-overview"
import { getScheduleData } from "@/lib/data/schedule"
import {
  formatDuration,
  formatLongDate,
  formatRelativeDay,
  formatTime,
  formatWeekday,
  fromDateKey,
  greetingFor,
} from "@/lib/format"

export const metadata: Metadata = { title: "Dashboard" }

// Task-based sections (priorities, progress, deadlines, week) read the shared
// task store themselves. This page prepares the time-based parts: greeting,
// today's schedule and each day's hours.
export default async function DashboardPage() {
  // Render on every request so the greeting and "now" marker are current.
  await connection()
  const now = new Date()
  const { student, schedule, week } = getScheduleData(now)

  const nextIndex = schedule.findIndex((block) => block.start > now)
  const scheduleItems: ScheduleItem[] = schedule.map((block, index) => ({
    id: block.id,
    kind: block.kind,
    title: block.title,
    category: block.category,
    location: block.location,
    startLabel: formatTime(block.start),
    endLabel: formatTime(block.end),
    durationLabel: formatDuration((block.end.getTime() - block.start.getTime()) / 60_000),
    status:
      block.end <= now ? "past" : block.start <= now ? "now" : index === nextIndex ? "next" : "later",
  }))

  const weekDays: WeekDayLoad[] = week.map((day, index) => ({
    ...day,
    shortLabel: index === 0 ? "Today" : formatWeekday(fromDateKey(day.date), "short"),
    longLabel: index === 0 ? "Today" : formatRelativeDay(fromDateKey(day.date), now),
    isToday: index === 0,
  }))

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
        <DashboardHeader
          greeting={greetingFor(now)}
          firstName={student.firstName}
          dateLabel={formatLongDate(now)}
        />
        <DailyProgress />
      </div>

      {/*
        Desktop (xl): two columns. Left = priorities + week; right = schedule + deadlines.
        Smaller screens: one column, ordered priorities → schedule → deadlines → week.
        The column wrappers use `contents` below xl so `order-*` can interleave their children.
      */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="contents xl:flex xl:flex-col xl:gap-6">
          <PriorityTasks className="order-1" />
          <WeekOverview days={weekDays} className="order-4" />
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-6">
          <TodaySchedule items={scheduleItems} className="order-2" />
          <UpcomingDeadlines className="order-3" />
        </div>
      </div>
    </div>
  )
}
