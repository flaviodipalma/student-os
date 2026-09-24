"use client"

import Link from "next/link"
import { AlertTriangleIcon, InfoIcon } from "lucide-react"
import { NotificationItem } from "@/components/notifications/notification-center"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { addDays } from "@/lib/format"
import { useNotifications } from "@/lib/notification-store"
import type { PlannerWarning } from "@/lib/planner"
import { usePlan } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import type { NotificationType } from "@/lib/types"
import { cn } from "@/lib/utils"

// "Needs attention" on the Dashboard: real problems with today's plan, from the
// Planner (overdue work, not enough time before a deadline, missed sessions,
// important work due tomorrow), plus reminders about something starting soon.
// Low-value notes (e.g. missing estimates) stay on the Planner page. Nothing is
// worked out here: warnings come from the Planner, reminders from notifications.

const MAX_ITEMS = 5
// Reminders that are about "right now" (overdue and deadline reminders are
// already covered by the Planner's warnings).
const timely: NotificationType[] = ["study_session_upcoming", "event_upcoming", "task_due_soon"]

export function NeedsAttention({ className }: { className?: string }) {
  const { today } = useTasks()
  const plan = usePlan(today)
  const { notifications } = useNotifications()
  const warnings = plan.warnings.filter((warning) => warning.severity !== "low" || warning.kind === "missed")
  const reminders = notifications.filter((n) => !n.readAt && timely.includes(n.type))
  const total = warnings.length + reminders.length
  if (total === 0) return null

  const shownWarnings = warnings.slice(0, MAX_ITEMS)
  const shownReminders = reminders.slice(0, Math.max(0, MAX_ITEMS - shownWarnings.length))

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Needs attention</CardTitle>
        <CardDescription>
          {total === 1 ? "1 thing" : `${total} things`} to look at
          {total > MAX_ITEMS && ` · the ${MAX_ITEMS} most important`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y">
          {shownWarnings.map((warning) => (
            <WarningItem key={warning.id} warning={warning} today={today} />
          ))}
          {shownReminders.map((notification) => (
            <NotificationItem key={notification.id} notification={notification} compact />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

// Severity is said in words too, not only with color.
function WarningItem({ warning, today }: { warning: PlannerWarning; today: string }) {
  const high = warning.severity === "high"
  const Icon = high ? AlertTriangleIcon : InfoIcon
  const link =
    warning.action === "view-task" && warning.taskIds[0]
      ? { href: `/tasks?task=${warning.taskIds[0]}`, label: "Open task" }
      : warning.action === "plan-next-day"
        ? { href: `/planner?date=${addDays(today, 1)}`, label: "Plan tomorrow" }
        : { href: "/planner", label: "Open planner" }
  return (
    <li className="flex gap-3 px-4 py-3">
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", high ? "text-danger" : "text-warning")} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs font-medium text-muted-foreground">
          <span className={high ? "text-danger" : "text-warning"}>{high ? "Urgent" : "Heads up"}</span>
        </p>
        <p className="text-sm">{warning.message}</p>
        <Link
          href={link.href}
          className="inline-flex min-h-8 items-center rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {link.label}
        </Link>
      </div>
    </li>
  )
}
