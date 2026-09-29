"use client"

import { useEffect } from "react"
import { touchPushSubscriptionAction } from "@/app/actions/push"
import { currentSubscription, registerServiceWorker } from "@/lib/push-client"

// Registers the service worker (public/sw.js: push reminders) on every signed-in
// page, and, on a device with push on, keeps its time zone current on the server
// (reminders sent while the app is closed use it).
export function ServiceWorkerSetup() {
  useEffect(() => {
    void (async () => {
      if (!(await registerServiceWorker())) return
      const subscription = await currentSubscription()
      if (subscription) await touchPushSubscriptionAction(subscription.endpoint, Intl.DateTimeFormat().resolvedOptions().timeZone).catch(() => null)
    })()
  }, [])
  return null
}
