import type { Metadata } from "next"
import { connection } from "next/server"
import { DailyProgress } from "@/components/dashboard/daily-progress"
import { DashboardHeader } from "@/components/dashboard/dashboard-header"
import { GettingStarted } from "@/components/dashboard/getting-started"
import { PriorityTasks } from "@/components/dashboard/priority-tasks"
import { TodaySchedule } from "@/components/dashboard/today-schedule"
import { UpcomingDeadlines } from "@/components/dashboard/upcoming-deadlines"
import { WeekOverview } from "@/components/dashboard/week-overview"
import { formatLongDate, greetingFor } from "@/lib/format"
import { getStudentClock } from "@/server/student-clock"

export const metadata: Metadata = { title: "Dashboard" }

// Every section reads the shared task and event stores itself; this page only
// works out the greeting and date (in the student's time zone).
export default async function DashboardPage() {
  // Render on every request so the greeting and date are current.
  await connection()
  const { now } = await getStudentClock()

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_18rem] md:items-end">
        <DashboardHeader greeting={greetingFor(now)} dateLabel={formatLongDate(now)} />
        <DailyProgress />
      </div>

      <GettingStarted />

      {/*
        "What do I need to do today?" first:
        Desktop (xl): left = today's plan + the week; right = deadlines + what's due today.
        Smaller screens: one column, ordered plan → deadlines → due today → week.
        The column wrappers use `contents` below xl so `order-*` can interleave their children.
      */}
      <div className="flex flex-col gap-6 xl:grid xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <div className="contents xl:flex xl:flex-col xl:gap-6">
          <TodaySchedule className="order-1" />
          <WeekOverview className="order-4" />
        </div>
        <div className="contents xl:flex xl:flex-col xl:gap-6">
          <UpcomingDeadlines className="order-2" />
          <PriorityTasks className="order-3" />
        </div>
      </div>
    </div>
  )
}
