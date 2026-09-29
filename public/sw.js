// Quadernio service worker: shows reminders sent by push (Web Push), even when
// Quadernio isn't open, and opens the right page when one is tapped. Nothing is
// cached (no offline mode) and nothing is read from the page.

self.addEventListener("install", () => self.skipWaiting())
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()))

// Only paths inside Quadernio ("/tasks?task=…"), never another site.
const safePath = (url) => (typeof url === "string" && url.startsWith("/") && !url.startsWith("//") ? url : "/dashboard")

self.addEventListener("push", (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = typeof data.title === "string" && data.title ? data.title : "Quadernio"
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      // The reminder's id: the same reminder never shows twice (the open app uses it too).
      tag: typeof data.tag === "string" ? data.tag : undefined,
      data: { url: safePath(data.url) },
    })
  )
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const url = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
      const open = windows.find((client) => new URL(client.url).origin === self.location.origin)
      if (open) {
        await open.focus()
        return open.navigate(url)
      }
      return self.clients.openWindow(url)
    })()
  )
})
