import type { Metadata } from "next"
import { ComingSoon } from "@/components/coming-soon"
import { PageHeader } from "@/components/app-shell/page-header"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/calendar")

export const metadata: Metadata = { title: section.title }

export default function CalendarPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <ComingSoon
        icon={section.icon}
        title={section.title}
        planned={[
          "See classes, events and deadlines by day, week or month",
          "Import your existing calendar (Google, iCal)",
        ]}
      />
    </>
  )
}
