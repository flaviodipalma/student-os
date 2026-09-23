"use client"

import { useState } from "react"
import Link from "next/link"
import {
  AlarmClockIcon,
  BellIcon,
  CalendarClockIcon,
  CalendarXIcon,
  CheckCheckIcon,
  ClipboardListIcon,
  FlagIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { useNow } from "@/lib/clock"
import { useNotifications } from "@/lib/notification-store"
import type { AppNotification, NotificationType } from "@/lib/types"
import { cn } from "@/lib/utils"

// The bell in the app header and the list it opens. Reminders are created on
// the server; this only shows them and marks them read or dismissed.

export const notificationMeta: Record<NotificationType, { icon: typeof BellIcon; action: string; tone: string }> = {
  task_overdue: { icon: TriangleAlertIcon, action: "Open task", tone: "text-red-600" },
  important_deadline: { icon: FlagIcon, action: "Open task", tone: "text-amber-600" },
  task_due_soon: { icon: AlarmClockIcon, action: "Open task", tone: "text-amber-600" },
  study_session_upcoming: { icon: CalendarClockIcon, action: "Open study session", tone: "text-indigo-600" },
  study_session_missed: { icon: CalendarXIcon, action: "Open study session", tone: "text-muted-foreground" },
  event_upcoming: { icon: CalendarClockIcon, action: "Open calendar", tone: "text-teal-600" },
  daily_plan_ready: { icon: ClipboardListIcon, action: "Open planner", tone: "text-primary" },
}

// "just now", "5 min ago", "3 h ago", "yesterday", "Sep 21".
export function formatAgo(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  if (hours < 48) return "yesterday"
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

export function NotificationBell({ className }: { className?: string }) {
  const { notifications, unread, markAllRead } = useNotifications()
  const [open, setOpen] = useState(false)
  const label = unread > 0 ? `Notifications, ${unread} unread` : "Notifications"

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger render={<Button variant="ghost" size="icon" className={cn("relative", className)} />} aria-label={label}>
        <BellIcon className="size-5" />
        {unread > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 flex min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-4 font-semibold text-white"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b px-4 py-3">
          <div className="flex items-center justify-between gap-3 pr-8">
            <SheetTitle>Notifications</SheetTitle>
            {unread > 0 && (
              <Button variant="ghost" size="sm" onClick={markAllRead}>
                <CheckCheckIcon data-icon="inline-start" />
                Mark all as read
              </Button>
            )}
          </div>
          <SheetDescription className="sr-only">Your recent reminders</SheetDescription>
        </SheetHeader>
        {notifications.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            You&apos;re all caught up. Reminders about deadlines, study sessions and events will show up here.
          </p>
        ) : (
          <ul className="flex-1 divide-y overflow-y-auto">
            {notifications.map((notification) => (
              <NotificationItem key={notification.id} notification={notification} onOpen={() => setOpen(false)} />
            ))}
          </ul>
        )}
      </SheetContent>
    </Sheet>
  )
}

export function NotificationItem({ notification, onOpen, compact = false }: { notification: AppNotification; onOpen?: () => void; compact?: boolean }) {
  const { markRead, dismiss } = useNotifications()
  const now = useNow()
  const meta = notificationMeta[notification.type]
  const Icon = meta.icon
  const unread = !notification.readAt

  return (
    <li className={cn("flex gap-3 px-4 py-3", unread && !compact && "bg-primary/[0.03]")}>
      <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", meta.tone)} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{notification.title}</span>
          <span aria-hidden>·</span>
          {/* When it was delivered (a reminder for a later event can be delivered late). */}
          <time dateTime={notification.createdAt}>{formatAgo(notification.createdAt, now)}</time>
          {unread && (
            <span className="inline-flex items-center gap-1">
              <span aria-hidden className="size-1.5 rounded-full bg-primary" />
              <span className="sr-only">Unread</span>
            </span>
          )}
        </p>
        <p className="text-sm">{notification.message}</p>
        <div className="flex flex-wrap gap-x-3 gap-y-1 pt-0.5">
          <Link
            href={notification.link}
            onClick={() => {
              markRead(notification.id)
              onOpen?.()
            }}
            className="rounded-sm text-xs font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {meta.action}
          </Link>
          {unread && !compact && (
            <button
              type="button"
              onClick={() => markRead(notification.id)}
              className="rounded-sm text-xs font-medium text-muted-foreground outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Mark as read
            </button>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Dismiss: ${notification.message}`}
        onClick={() => dismiss(notification.id)}
        className="shrink-0 text-muted-foreground"
      >
        <XIcon />
      </Button>
    </li>
  )
}
