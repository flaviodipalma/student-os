import { z } from "zod"

// Push reminders (Web Push): what a browser sends when a student turns them on.
// The endpoint must belong to a real push service (the server sends requests to it,
// so any other address is refused).

const PUSH_HOSTS = [
  /^fcm\.googleapis\.com$/, // Chrome, Edge (Chromium), Android
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, // Firefox
  /^([a-z0-9-]+\.)*push\.apple\.com$/, // Safari, iPhone and iPad
  /^([a-z0-9-]+\.)*notify\.windows\.com$/, // older Edge on Windows
]

export function isPushServiceUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === "https:" && !url.port && !url.username && PUSH_HOSTS.some((host) => host.test(url.hostname))
  } catch {
    return false
  }
}

export const pushSubscriptionSchema = z.object({
  endpoint: z.string().max(2048).refine(isPushServiceUrl, "That isn't a push service address."),
  keys: z.object({
    p256dh: z.string().min(1).max(200).regex(/^[A-Za-z0-9_=-]+$/),
    auth: z.string().min(1).max(100).regex(/^[A-Za-z0-9_=-]+$/),
  }),
  timeZone: z.string().max(64).optional(),
  device: z.string().trim().max(80).default(""),
})
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>

// "Chrome on Mac" from a browser's user agent, for the student's list of devices.
export function deviceLabel(userAgent: string): string {
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /Firefox\//.test(userAgent)
      ? "Firefox"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Safari\//.test(userAgent)
          ? "Safari"
          : "Browser"
  const system = /iPhone/.test(userAgent)
    ? "iPhone"
    : /iPad/.test(userAgent)
      ? "iPad"
      : /Android/.test(userAgent)
        ? "Android"
        : /Mac OS X/.test(userAgent)
          ? "Mac"
          : /Windows/.test(userAgent)
            ? "Windows"
            : /Linux/.test(userAgent)
              ? "Linux"
              : ""
  return system ? `${browser} on ${system}` : browser
}

export type PushDevice = { id: string; device: string; addedAt: string; thisDevice: boolean }
