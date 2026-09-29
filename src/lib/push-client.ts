"use client"

// The browser side of push reminders: the service worker (public/sw.js) and this
// device's push subscription.

export const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? ""

export const pushSupported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window

// iPhone / iPad: push only works in the app added to the home screen.
export const isIos = () => typeof navigator !== "undefined" && /iPhone|iPad|iPod/.test(navigator.userAgent)
export const isInstalled = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)

// Push reminders can be turned on in this browser (the server has keys, the browser
// supports push, and on iPhone the app is installed).
export const canPushHere = () => Boolean(PUBLIC_VAPID_KEY) && pushSupported() && !(isIos() && !isInstalled())

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
  } catch {
    return null
  }
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null
  const registration = await navigator.serviceWorker.getRegistration("/")
  return (await registration?.pushManager.getSubscription()) ?? null
}

function keyBytes(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/")
  const raw = window.atob(padded)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

// Asks the browser for permission (if needed) and subscribes this device.
export async function subscribeThisDevice(): Promise<PushSubscription> {
  const registration = (await registerServiceWorker()) ?? (await navigator.serviceWorker.ready)
  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission()
    if (permission !== "granted") throw new Error("denied")
  }
  return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(PUBLIC_VAPID_KEY) })
}

// What the server needs to know about this device's subscription.
export function subscriptionPayload(subscription: PushSubscription, device: string) {
  const json = subscription.toJSON()
  return {
    endpoint: subscription.endpoint,
    keys: { p256dh: json.keys?.p256dh ?? "", auth: json.keys?.auth ?? "" },
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    device,
  }
}
