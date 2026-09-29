import "server-only"

import { and, desc, eq, inArray } from "drizzle-orm"
import webpush from "web-push"
import { isValidTimeZone } from "@/lib/time-zone"
import type { PushDevice, PushSubscriptionInput } from "@/lib/push"
import { notifications, pushSubscriptions } from "../db/schema"
import type { Database } from "../db/types"
import { logger } from "../log"

// Push reminders (Web Push, standard in Chrome, Edge, Firefox and Safari, including
// iPhone apps added to the home screen). A device is saved when the student turns
// push on there; reminders are pushed as they're created (by the open app or the
// scheduled job, src/server/push/reminders-job.ts). Messages are encrypted to each
// device's keys; they carry a reminder's title, message and in-app link only.
//
// Keys (VAPID) identify this server to the push services:
//   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https:)
// Generate a pair with: npx web-push generate-vapid-keys

export function pushConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT)
}

export type PushMessage = { title: string; body: string; url: string; tag: string }
type Target = { endpoint: string; p256dh: string; auth: string }
// Sends one message; throws an error with `statusCode` when the push service refuses.
export type PushSender = (target: Target, message: PushMessage) => Promise<void>

export const webPushSender: PushSender = async (target, message) => {
  await webpush.sendNotification(
    { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
    JSON.stringify(message),
    {
      vapidDetails: {
        subject: process.env.VAPID_SUBJECT!,
        publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
        privateKey: process.env.VAPID_PRIVATE_KEY!,
      },
      // A reminder more than an hour late isn't worth showing.
      TTL: 60 * 60,
      urgency: "high",
    }
  )
}

// Saves (or refreshes) this device for the student. A browser's endpoint moves to
// whoever turns push on in it last (e.g. a shared computer).
export async function savePushSubscription(db: Database, userId: string, input: PushSubscriptionInput, now = new Date()) {
  const values = {
    userId,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    timeZone: isValidTimeZone(input.timeZone) ? input.timeZone : null,
    device: input.device,
    lastSeenAt: now,
  }
  await db
    .insert(pushSubscriptions)
    .values({ endpoint: input.endpoint, ...values })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: values })
}

// The app opened on a device with push on: keep its time zone current.
export async function touchPushSubscription(db: Database, userId: string, endpoint: string, timeZone: string | undefined, now = new Date()) {
  await db
    .update(pushSubscriptions)
    .set({ lastSeenAt: now, ...(isValidTimeZone(timeZone) ? { timeZone } : {}) })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}

export async function removePushSubscription(db: Database, userId: string, endpoint: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)))
}

// One of the student's devices, by id (from their list).
export async function removePushDevice(db: Database, userId: string, id: string) {
  await db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.id, id)))
}

export async function listPushDevices(db: Database, userId: string, thisEndpoint?: string): Promise<PushDevice[]> {
  const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).orderBy(desc(pushSubscriptions.lastSeenAt))
  return rows.map((row) => ({ id: row.id, device: row.device || "A browser", addedAt: row.createdAt.toISOString(), thisDevice: row.endpoint === thisEndpoint }))
}

// The time zone for the student's reminders while the app is closed: their most
// recently seen device's.
export async function pushTimeZone(db: Database, userId: string): Promise<string | undefined> {
  const [row] = await db
    .select({ timeZone: pushSubscriptions.timeZone })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.lastSeenAt))
    .limit(1)
  return row?.timeZone ?? undefined
}

// Pushes messages to all of the student's devices. Devices the push service says
// are gone (404/410: push turned off, app uninstalled) are removed. Never throws.
export async function pushToStudent(db: Database, userId: string, messages: PushMessage[], sender: PushSender = webPushSender, now = new Date()) {
  if (messages.length === 0 || (sender === webPushSender && !pushConfigured())) return { sent: 0, removed: 0 }
  const devices = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId))
  let sent = 0
  const gone: string[] = []
  for (const device of devices) {
    for (const message of messages) {
      try {
        await sender(device, message)
        sent++
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode
        if (status === 404 || status === 410) {
          gone.push(device.id)
          break
        }
        logger.warn("push", "send failed", { status: status ?? null })
      }
    }
  }
  if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone))
  if (sent > 0) {
    const reached = devices.filter((device) => !gone.includes(device.id)).map((device) => device.id)
    if (reached.length > 0) await db.update(pushSubscriptions).set({ lastSentAt: now }).where(inArray(pushSubscriptions.id, reached))
  }
  return { sent, removed: gone.length }
}

// The push messages for reminders just created (by id, the student's own only).
export async function pushMessagesFor(db: Database, userId: string, ids: string[]): Promise<PushMessage[]> {
  if (ids.length === 0) return []
  const rows = await db
    .select({ id: notifications.id, title: notifications.title, message: notifications.message, link: notifications.link })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), inArray(notifications.id, ids)))
  // Tagged with the reminder's id, like the open app's desktop notification: the same
  // reminder replaces itself instead of showing twice.
  return rows.map((row) => ({ title: row.title, body: row.message, url: row.link ?? "/dashboard", tag: row.id }))
}
