import Link from "next/link"
import { cn } from "@/lib/utils"

// The Calendar page's two views: the schedule (day / week) and the school's academic
// calendar. Links, so each has its own address (/calendar, /calendar?view=academic).
export function CalendarTabs({ current }: { current: "schedule" | "academic" }) {
  const tabs = [
    { id: "schedule", label: "Schedule", href: "/calendar" },
    { id: "academic", label: "Academic calendar", href: "/calendar?view=academic" },
  ] as const
  return (
    <nav aria-label="Calendar views" className="inline-flex rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={current === tab.id ? "page" : undefined}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            current === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
