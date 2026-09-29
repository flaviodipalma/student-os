"use server"

import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { pushSubscriptionSchema, type PushDevice } from "@/lib/push"
import { idSchema } from "@/lib/validation"
import { limitRate, parse, runAction } from "@/server/actions"
import {
  listPushDevices,
  pushToStudent,
  removePushDevice,
  removePushSubscription,
  savePushSubscription,
  touchPushSubscription,
} from "@/server/push"

// Push reminders in Settings > Notifications: turn them on or off for a device,
// see and remove devices, send a test. Always the signed-in student's own devices.

const endpointSchema = z.string().max(2048)

export async function savePushSubscriptionAction(input: unknown): Promise<ActionResult<PushDevice[]>> {
  return runAction(async ({ db, userId }) => {
    const subscription = parse(pushSubscriptionSchema, input)
    await savePushSubscription(db, userId, subscription)
    return listPushDevices(db, userId, subscription.endpoint)
  })
}

export async function removePushSubscriptionAction(endpoint: unknown): Promise<ActionResult<PushDevice[]>> {
  return runAction(async ({ db, userId }) => {
    await removePushSubscription(db, userId, parse(endpointSchema, endpoint))
    return listPushDevices(db, userId)
  })
}

// Another of the student's devices, from the list.
export async function removePushDeviceAction(id: unknown, thisEndpoint?: unknown): Promise<ActionResult<PushDevice[]>> {
  return runAction(async ({ db, userId }) => {
    await removePushDevice(db, userId, parse(idSchema, id))
    const endpoint = endpointSchema.safeParse(thisEndpoint)
    return listPushDevices(db, userId, endpoint.success ? endpoint.data : undefined)
  })
}

export async function listPushDevicesAction(thisEndpoint?: unknown): Promise<ActionResult<PushDevice[]>> {
  return runAction(async ({ db, userId }) => {
    const endpoint = endpointSchema.safeParse(thisEndpoint)
    return listPushDevices(db, userId, endpoint.success ? endpoint.data : undefined)
  })
}

// The app opened on a device with push on: its time zone stays current.
export async function touchPushSubscriptionAction(endpoint: unknown, timeZone: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await touchPushSubscription(db, userId, parse(endpointSchema, endpoint), typeof timeZone === "string" ? timeZone : undefined)
    return null
  })
}

export async function sendTestPushAction(): Promise<ActionResult<{ sent: number }>> {
  return runAction(async ({ db, userId }) => {
    limitRate(userId, "push-test", [{ limit: 5, windowMs: 10 * 60_000 }])
    const { sent } = await pushToStudent(db, userId, [
      { title: "Student OS", body: "Push reminders work on this device.", url: "/dashboard", tag: `test:${Date.now()}` },
    ])
    return { sent }
  })
}
