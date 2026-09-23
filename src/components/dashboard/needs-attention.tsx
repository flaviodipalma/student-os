"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { NotificationItem } from "@/components/notifications/notification-center"
import { useNotifications } from "@/lib/notification-store"
import type { NotificationType } from "@/lib/types"

// "Needs attention" on the Dashboard: the few unread reminders that matter most
// right now, from the same notifications as the bell (no logic of its own).
// Today's plan is already on the Dashboard, so that reminder isn't repeated here.

const MAX_ITEMS = 4
const priority: Record<NotificationType, number> = {
  task_overdue: 0,
  study_session_upcoming: 1,
  event_upcoming: 2,
  task_due_soon: 3,
  important_deadline: 4,
  study_session_missed: 5,
  daily_plan_ready: 99,
}

export function NeedsAttention({ className }: { className?: string }) {
  const { notifications } = useNotifications()
  const items = notifications
    .filter((notification) => !notification.readAt && notification.type !== "daily_plan_ready")
    .sort((a, b) => priority[a.type] - priority[b.type] || b.scheduledFor.localeCompare(a.scheduledFor))
  if (items.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Needs attention</CardTitle>
        <CardDescription>
          {items.length === 1 ? "1 reminder" : `${items.length} reminders`}
          {items.length > MAX_ITEMS && ` · showing the ${MAX_ITEMS} most important (all in the bell)`}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0">
        <ul className="divide-y">
          {items.slice(0, MAX_ITEMS).map((notification) => (
            <NotificationItem key={notification.id} notification={notification} compact />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
