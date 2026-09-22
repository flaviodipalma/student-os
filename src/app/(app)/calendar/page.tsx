import type { Metadata } from "next"
import { CalendarView } from "@/components/calendar/calendar-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/calendar")

export const metadata: Metadata = { title: section.title }

export default function CalendarPage() {
  return <CalendarView />
}
