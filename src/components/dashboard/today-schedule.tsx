import { MapPinIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ScheduleKind } from "@/lib/types"
import { cn } from "@/lib/utils"

export type ScheduleItem = {
  id: string
  kind: ScheduleKind
  title: string
  category?: string
  location?: string
  startLabel: string
  endLabel: string
  durationLabel: string
  status: "past" | "now" | "next" | "later"
}

const kindStyle: Record<ScheduleKind, { label: string; block: string; swatch: string }> = {
  fixed: {
    label: "Fixed",
    block: "border-l-teal-500 bg-teal-500/[0.06]",
    swatch: "bg-teal-500",
  },
  study: {
    label: "Study",
    block: "border-l-primary bg-primary/[0.06]",
    swatch: "bg-primary",
  },
  free: {
    label: "Free",
    block: "border-l border-dashed border-foreground/15 bg-transparent",
    swatch: "border border-dashed border-foreground/40",
  },
}

export function TodaySchedule({
  items,
  className,
}: {
  items: ScheduleItem[]
  className?: string
}) {
  const allPast = items.every((item) => item.status === "past")

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Today&apos;s schedule</CardTitle>
        <CardDescription>
          {allPast ? "That's everything for today." : `${items.length} blocks planned`}
        </CardDescription>
        <ul aria-label="Legend" className="mt-2 flex gap-4 text-xs text-muted-foreground">
          {(Object.keys(kindStyle) as ScheduleKind[]).map((kind) => (
            <li key={kind} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-sm", kindStyle[kind].swatch)} />
              {kindStyle[kind].label}
            </li>
          ))}
        </ul>
      </CardHeader>
      <CardContent>
        <ol className="space-y-2">
          {items.map((item) => {
            const style = kindStyle[item.kind]
            const isFree = item.kind === "free"
            return (
              <li
                key={item.id}
                aria-current={item.status === "now" ? "time" : undefined}
                className={cn(
                  "grid grid-cols-[4.25rem_minmax(0,1fr)] gap-3",
                  item.status === "past" && "opacity-55"
                )}
              >
                <div className="pt-2 text-right text-sm tabular-nums">
                  <p className="font-medium">{item.startLabel}</p>
                </div>
                <div
                  className={cn(
                    "rounded-lg border border-l-[3px] border-transparent px-3 py-2",
                    style.block,
                    item.status === "now" && "ring-2 ring-primary/30"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className={cn("font-medium leading-snug", isFree && "text-muted-foreground")}>
                      <span className="sr-only">{style.label}: </span>
                      {item.title}
                    </p>
                    {item.status === "now" && (
                      <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                        Now
                      </span>
                    )}
                    {item.status === "next" && (
                      <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        Up next
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {[item.durationLabel, `until ${item.endLabel}`, item.category]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    {item.location && (
                      <span className="inline-flex items-center gap-0.5">
                        <MapPinIcon aria-hidden className="size-3" />
                        {item.location}
                      </span>
                    )}
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}
