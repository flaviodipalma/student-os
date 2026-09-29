import Link from "next/link"
import { cn } from "@/lib/utils"

// Tabs at the top of a page (Calendar, Settings). Links, so each tab has its own
// address and the browser's back button works.
export function PageTabs({ label, tabs, current }: { label: string; tabs: { id: string; label: string; href: string }[]; current: string }) {
  return (
    <nav aria-label={label} className="inline-flex max-w-full overflow-x-auto rounded-lg bg-muted p-1">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={current === tab.id ? "page" : undefined}
          className={cn(
            "shrink-0 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            current === tab.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
