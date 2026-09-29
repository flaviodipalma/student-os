import type { Metadata } from "next"
import { AcademicCalendarCard } from "@/components/calendar/academic-calendar-card"
import { CalendarTabs } from "@/components/calendar/calendar-tabs"
import { CalendarView } from "@/components/calendar/calendar-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/calendar")

export const metadata: Metadata = { title: section.title }

const DATE = /^\d{4}-\d{2}-\d{2}$/

// /calendar: the schedule (?date= opens a day, ?external= an external event's details).
// /calendar?view=academic: the school's academic calendar (semesters, breaks, exams).
export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { date, external, view } = await searchParams
  if (view === "academic") {
    return (
      <div className="space-y-4">
        <title>Academic calendar · Student OS</title>
        <h1 className="sr-only">Academic calendar</h1>
        <CalendarTabs current="academic" />
        <AcademicCalendarCard />
      </div>
    )
  }
  const initialDate = typeof date === "string" && DATE.test(date) ? date : undefined
  const initialExternalId = typeof external === "string" ? external : undefined
  return (
    <div className="space-y-4">
      <CalendarTabs current="schedule" />
      <CalendarView key={`${initialDate}-${initialExternalId}`} initialDate={initialDate} initialExternalId={initialExternalId} />
    </div>
  )
}
