import { CircleDashedIcon, ExternalLinkIcon } from "lucide-react"
import { priorityLabel } from "@/lib/tasks"
import { lmsProviderNames, type ExternalSource, type Priority } from "@/lib/types"
import { cn } from "@/lib/utils"

const priorityClass: Record<Priority, string> = {
  critical: "bg-red-600 text-white ring-red-700",
  high: "bg-red-50 text-red-700 ring-red-600/15",
  medium: "bg-amber-50 text-amber-800 ring-amber-600/20",
  low: "bg-muted text-muted-foreground ring-foreground/10",
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset",
        priorityClass[priority],
        className
      )}
    >
      {priorityLabel[priority]}
      <span className="sr-only"> priority</span>
    </span>
  )
}

export function InProgressBadge() {
  return (
    <span className="inline-flex items-center gap-1 font-medium text-primary">
      <CircleDashedIcon aria-hidden className="size-3.5" />
      In progress
    </span>
  )
}

// Where an imported task came from, with a link back to it ("Open in Canvas").
// Links were checked when imported (the student's own LMS, HTTPS); they're
// checked again here and open in a new tab without access to this page.
export function SourceBadge({ source }: { source: ExternalSource }) {
  const name = lmsProviderNames[source.provider]
  const url = source.url?.startsWith("https://") ? source.url : undefined
  return (
    <span className="inline-flex items-center gap-2">
      <span className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground">From {name}</span>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          Open in {name}
          <ExternalLinkIcon aria-hidden className="size-3" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      )}
    </span>
  )
}
