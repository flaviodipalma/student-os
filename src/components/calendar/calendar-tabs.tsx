import { PageTabs } from "@/components/app-shell/page-tabs"

// The Calendar page's two views: the schedule (day / week) and the school's academic
// calendar (/calendar, /calendar?view=academic).
export function CalendarTabs({ current }: { current: "schedule" | "academic" }) {
  return (
    <PageTabs
      label="Calendar views"
      current={current}
      tabs={[
        { id: "schedule", label: "Schedule", href: "/calendar" },
        { id: "academic", label: "Academic calendar", href: "/calendar?view=academic" },
      ]}
    />
  )
}
