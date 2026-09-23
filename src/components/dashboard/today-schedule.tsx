"use client"

import Link from "next/link"
import { AlertTriangleIcon, ArrowRightIcon, RepeatIcon, SparklesIcon } from "lucide-react"
import { eventStyle } from "@/components/calendar/event-style"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useNow } from "@/lib/clock"
import { useEvents } from "@/lib/event-store"
import { toMinutes } from "@/lib/events"
import { formatTime, fromDateKey } from "@/lib/format"
import { buildDayTimeline, type DailyPlan, type TimelineItem } from "@/lib/planner"
import { usePlan } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import { cn } from "@/lib/utils"

// A short version of today's plan: what's left of the day, in order.
// Reads the same DailyPlan as the Planner page (usePlan), so both always agree;
// no planning happens here.

const MAX_ITEMS = 6

function summary(plan: DailyPlan, events: number): string {
  const suggested = plan.suggestions.length
  if (plan.status === "no-tasks") return "You're all caught up."
  if (plan.status === "all-done") return "All your tasks are done. Nice work!"
  if (plan.status === "no-time" && events === 0) return "You don't have any available study time today."
  const parts = [`${events} ${events === 1 ? "event" : "events"}`]
  if (suggested > 0) parts.push(`${suggested} recommended study ${suggested === 1 ? "session" : "sessions"}`)
  return parts.join(" · ")
}

export function TodaySchedule({ className }: { className?: string }) {
  const { scheduleOn } = useEvents()
  const { tasks, today } = useTasks()
  const now = useNow()
  const plan = usePlan(today)
  const todays = scheduleOn(today)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const taskTitle = new Map(tasks.map((task) => [task.id, task.title]))

  // Events and study sessions still ahead (or happening now); no free time or breaks.
  const upcoming = buildDayTimeline(plan, todays).filter(
    (item): item is Extract<TimelineItem, { kind: "event" | "session" }> =>
      (item.kind === "event" || item.kind === "session") && toMinutes(item.end) > nowMinutes
  )
  const shown = upcoming.slice(0, MAX_ITEMS)
  const urgent = plan.warnings.filter((warning) => warning.severity === "high")
  const time = (hhmm: string) => formatTime(fromDateKey(today, hhmm))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Today&apos;s plan</CardTitle>
        <CardDescription>{summary(plan, todays.filter((e) => !e.sessionId).length)}</CardDescription>
        <CardAction>
          <Link
            href="/calendar"
            className="rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Calendar
          </Link>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        {urgent.length > 0 && (
          <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900 ring-1 ring-red-200">
            <AlertTriangleIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-red-600" />
            {urgent[0].message}
            {urgent.length > 1 && ` (+${urgent.length - 1} more in your plan)`}
          </p>
        )}

        {shown.length === 0 ? (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {upcoming.length === 0 && todays.length > 0 ? "Nothing else planned for today." : summary(plan, 0)}
          </p>
        ) : (
          <ol className="space-y-1.5">
            {shown.map((item) => {
              const suggested = item.kind === "session" && item.session.status === "suggested"
              const title =
                item.kind === "event"
                  ? item.event.title
                  : `Study — ${taskTitle.get(item.session.taskId) ?? item.event?.title ?? "task"}`
              const style = item.kind === "event" ? eventStyle[item.event.type].block : eventStyle.study.block
              return (
                <li
                  key={item.key}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg px-3 py-2 text-sm",
                    suggested ? "border border-dashed border-primary/45 bg-primary/[0.04]" : cn("border-l-[3px]", style)
                  )}
                >
                  <span className="text-xs font-medium whitespace-nowrap tabular-nums opacity-80">
                    {time(item.start)}–{time(item.end)}
                  </span>
                  <span className="flex min-w-0 items-center gap-1.5 font-medium">
                    {suggested && <SparklesIcon aria-label="Recommended" className="size-3.5 shrink-0 text-primary" />}
                    {item.kind === "event" && item.event.commitmentId && (
                      <RepeatIcon aria-label="Repeats weekly" className="size-3.5 shrink-0 opacity-70" />
                    )}
                    <span className="truncate">{title}</span>
                  </span>
                </li>
              )
            })}
          </ol>
        )}
        {upcoming.length > shown.length && (
          <p className="text-xs text-muted-foreground">+{upcoming.length - shown.length} more later today</p>
        )}

        <Link
          href="/planner"
          className="inline-flex items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          View full plan
          <ArrowRightIcon aria-hidden className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}
