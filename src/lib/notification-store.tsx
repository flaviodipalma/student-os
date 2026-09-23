"use client"

import { createContext, use, useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  dismissNotificationAction,
  markAllNotificationsReadAction,
  markNotificationReadAction,
  syncNotificationsAction,
  updateNotificationPreferencesAction,
} from "@/app/actions/notifications"
import type { ActionResult } from "@/lib/action-result"
import { useAppStore } from "@/lib/app-store"
import { useFeedback } from "@/lib/feedback"
import type { AppNotification, NotificationPreferences } from "@/lib/types"

// Reminders in the browser: the delivered notifications and the student's
// reminder settings. It only DELIVERS; which reminders exist is decided on the
// server (src/lib/notifications/generate.ts via syncNotificationsAction):
//
//   - on load, every minute while the app is open, and shortly after the
//     student's tasks or study sessions change, it asks the server to sync
//   - new reminders appear in the notification center and on the Dashboard, and
//     as desktop notifications if the student turned those on and the browser
//     allows it (only while Student OS is open in a tab; see the README)

const SYNC_EVERY_MS = 60_000
const AFTER_CHANGE_MS = 1_500

type NotificationStore = {
  notifications: AppNotification[]
  unread: number
  preferences: NotificationPreferences
  markRead: (id: string) => void
  markAllRead: () => void
  dismiss: (id: string) => void
  updatePreferences: (next: NotificationPreferences) => Promise<ActionResult<NotificationPreferences>>
}

const NotificationContext = createContext<NotificationStore | null>(null)

// A desktop notification for a new reminder, if allowed. Clicking it opens the page it's about.
function showDesktop(notification: AppNotification, open: (link: string) => void) {
  if (typeof window === "undefined" || !("Notification" in window) || Notification.permission !== "granted") return
  try {
    const desktop = new Notification(notification.title, { body: notification.message, tag: notification.id })
    desktop.onclick = () => {
      window.focus()
      open(notification.link)
      desktop.close()
    }
  } catch {
    // Some browsers only allow notifications from a service worker; the in-app center still has it.
  }
}

export function NotificationProvider({
  initial,
  initialPreferences,
  children,
}: {
  initial: AppNotification[]
  initialPreferences: NotificationPreferences
  children: React.ReactNode
}) {
  const router = useRouter()
  const { showError } = useFeedback()
  const { tasks, studySessions } = useAppStore()
  const [notifications, setNotifications] = useState(initial)
  const [preferences, setPreferences] = useState(initialPreferences)
  // Read by the sync (which shouldn't restart when settings change).
  const preferencesRef = useRef(preferences)
  useEffect(() => {
    preferencesRef.current = preferences
  }, [preferences])

  // The sync is stable for the provider's lifetime (the timers below never restart).
  const routerRef = useRef(router)
  useEffect(() => {
    routerRef.current = router
  }, [router])
  const sync = useCallback(async () => {
    const result = await syncNotificationsAction().catch(() => null)
    if (!result?.ok) return
    setNotifications(result.data.notifications)
    if (preferencesRef.current.browserNotifications && document.visibilityState !== "visible") {
      const created = new Set(result.data.created)
      for (const notification of result.data.notifications) {
        if (created.has(notification.id)) showDesktop(notification, (link) => routerRef.current.push(link))
      }
    }
  }, [])

  // On load and every minute.
  useEffect(() => {
    const first = setTimeout(sync, 0)
    const timer = setInterval(sync, SYNC_EVERY_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [sync])

  // Soon after the student's work changes (a task done, a session moved), so
  // reminders follow straight away. The first render is the load sync above.
  const loaded = useRef(false)
  useEffect(() => {
    if (!loaded.current) {
      loaded.current = true
      return
    }
    const timer = setTimeout(sync, AFTER_CHANGE_MS)
    return () => clearTimeout(timer)
  }, [tasks, studySessions, sync])

  // Changes show at once; if saving fails, the list is reloaded from the server.
  const run = (request: Promise<ActionResult<null>>) =>
    request
      .catch(() => ({ ok: false as const, error: "We couldn't update your notifications. Please try again.", code: "database" as const }))
      .then((result) => {
        if (!result.ok) {
          showError(result.error)
          void sync()
        }
      })

  const store: NotificationStore = {
    notifications,
    unread: notifications.filter((notification) => !notification.readAt).length,
    preferences,
    markRead: (id) => {
      const readAt = new Date().toISOString()
      setNotifications((prev) => prev.map((n) => (n.id === id && !n.readAt ? { ...n, readAt } : n)))
      void run(markNotificationReadAction(id))
    },
    markAllRead: () => {
      const readAt = new Date().toISOString()
      setNotifications((prev) => prev.map((n) => (n.readAt ? n : { ...n, readAt })))
      void run(markAllNotificationsReadAction())
    },
    dismiss: (id) => {
      setNotifications((prev) => prev.filter((n) => n.id !== id))
      void run(dismissNotificationAction(id))
    },
    updatePreferences: async (next) => {
      const result = await updateNotificationPreferencesAction(next).catch(() => null)
      if (!result) return { ok: false, error: "We couldn't save that. Check your connection and try again.", code: "database" }
      if (result.ok) {
        setPreferences(result.data)
        void sync()
      }
      return result
    },
  }

  return <NotificationContext value={store}>{children}</NotificationContext>
}

export function useNotifications(): NotificationStore {
  const store = use(NotificationContext)
  if (!store) throw new Error("useNotifications must be used inside NotificationProvider")
  return store
}
