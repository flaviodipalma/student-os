import { ChevronDownIcon, ChevronsUpIcon, ChevronUpIcon, CircleDashedIcon, EqualIcon, ExternalLinkIcon, type LucideIcon } from "lucide-react"
import { priorityLabel } from "@/lib/tasks"
import { lmsProviderNames, type ExternalSource, type Priority } from "@/lib/types"
import { cn } from "@/lib/utils"

const priorityClass: Record<Priority, string> = {
  critical: "bg-danger-solid text-white ring-danger-solid",
  high: "bg-danger-soft text-danger ring-danger-border",
  medium: "bg-warning-soft text-warning ring-warning-border",
  low: "bg-muted text-muted-foreground ring-border",
}

// Priority is said with an icon and a word, never by color alone.
const priorityIcon: Record<Priority, LucideIcon> = {
  critical: ChevronsUpIcon,
  high: ChevronUpIcon,
  medium: EqualIcon,
  low: ChevronDownIcon,
}

export function PriorityBadge({ priority, className }: { priority: Priority; className?: string }) {
  const Icon = priorityIcon[priority]
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-md py-0.5 pr-1.5 pl-1 text-xs font-medium ring-1 ring-inset",
        priorityClass[priority],
        className
      )}
    >
      <Icon aria-hidden className="size-3.5" />
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
      {(source.submissionStatus === "submitted" || source.submissionStatus === "graded") && (
        <span className="rounded bg-success-soft px-1.5 py-0.5 text-xs font-medium text-success ring-1 ring-success-border ring-inset">
          {source.submissionStatus === "graded" ? "Graded" : "Submitted"} in {name}
        </span>
      )}
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
