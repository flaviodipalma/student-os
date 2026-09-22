import type { Metadata } from "next"
import { connection } from "next/server"
import { DailyProgress } from "@/components/dashboard/daily-progress"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { PriorityTasks } from "@/components/dashboard/priority-tasks"
import { TodaySchedule } from "@/components/dashboard/today-schedule"
import { UpcomingDeadlines } from "@/components/dashboard/upcoming-deadlines"
import { WeekOverview } from "@/components/dashboard/week-overview"
import { student } from "@/lib/data/student"
import { formatLongDate, greetingFor } from "@/lib/format"

export const metadata: Metadata = { title: "Dashboard" }

// Every section reads the shared task and event stores itself; this page only
// works out the greeting and date.
export default async function DashboardPage() {
  // Render on every request so the greeting and date are current.
  await connection()
  const now = new Date()

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
          <WeekOverview className="order-4" />
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-6">
          <TodaySchedule className="order-2" />
          <UpcomingDeadlines className="order-3" />
        </div>
      </div>
    </div>
  )
}
