import type { Metadata } from "next"
import { CalendarView } from "@/components/calendar/calendar-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/calendar")

export const metadata: Metadata = { title: section.title }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function CalendarPage({ searchParams }: PageProps<"/calendar">) {
  const { date, external } = await searchParams
  const initialDate = typeof date === "string" && DATE.test(date) ? date : undefined
  const initialExternalId = typeof external === "string" ? external : undefined
  return <CalendarView key={`${initialDate}-${initialExternalId}`} initialDate={initialDate} initialExternalId={initialExternalId} />
}
