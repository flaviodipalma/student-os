"use client"

import { useEffect, useState } from "react"
import { BellRingIcon, SmartphoneIcon, Trash2Icon } from "lucide-react"
import {
  listPushDevicesAction,
  removePushDeviceAction,
  removePushSubscriptionAction,
  savePushSubscriptionAction,
  sendTestPushAction,
} from "@/app/actions/push"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useFeedback } from "@/lib/feedback"
import { deviceLabel, type PushDevice } from "@/lib/push"
import { currentSubscription, isInstalled, isIos, PUBLIC_VAPID_KEY, pushSupported, subscribeThisDevice, subscriptionPayload } from "@/lib/push-client"

// Settings > Push reminders: reminders on this phone or computer even when Student OS
// is closed. On per device (each browser asks for permission); the reminder kinds
// and timing are the Reminders settings above.

type Status = "loading" | "not-configured" | "unsupported" | "install-first" | "blocked" | "off" | "on"

export function PushSettingsCard() {
  const { showError, showSuccess } = useFeedback()
  const [status, setStatus] = useState<Status>("loading")
  const [endpoint, setEndpoint] = useState<string | null>(null)
  const [devices, setDevices] = useState<PushDevice[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      if (!PUBLIC_VAPID_KEY) return setStatus("not-configured")
      if (isIos() && !isInstalled()) return setStatus("install-first")
      if (!pushSupported()) return setStatus("unsupported")
      const subscription = await currentSubscription()
      setEndpoint(subscription?.endpoint ?? null)
      const list = await listPushDevicesAction(subscription?.endpoint).catch(() => null)
      if (list?.ok) setDevices(list.data)
      setStatus(Notification.permission === "denied" ? "blocked" : subscription ? "on" : "off")
    })()
  }, [])

  async function turnOn() {
    setBusy(true)
    try {
      const subscription = await subscribeThisDevice()
      const result = await savePushSubscriptionAction(subscriptionPayload(subscription, deviceLabel(navigator.userAgent)))
      if (!result.ok) {
        await subscription.unsubscribe().catch(() => {})
        return showError(result.error)
      }
      setEndpoint(subscription.endpoint)
      setDevices(result.data)
      setStatus("on")
      showSuccess("Push reminders are on for this device.")
    } catch (error) {
      if (error instanceof Error && error.message === "denied") setStatus(Notification.permission === "denied" ? "blocked" : "off")
      else showError("This browser couldn't turn on push reminders. Try again.")
    } finally {
      setBusy(false)
    }
  }

  async function turnOff() {
    setBusy(true)
    const subscription = await currentSubscription()
    await subscription?.unsubscribe().catch(() => {})
    const result = subscription ? await removePushSubscriptionAction(subscription.endpoint) : null
    if (result?.ok) setDevices(result.data)
    setEndpoint(null)
    setStatus("off")
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    const result = await sendTestPushAction()
    setBusy(false)
    if (!result.ok) return showError(result.error)
    if (result.data.sent === 0) showError("No device received it. Turn push reminders off and on again.")
    else
      showSuccess(
        `Test sent to ${result.data.sent} ${result.data.sent === 1 ? "device" : "devices"}. Nothing showing up? Check that notifications are allowed for your browser in your device's settings, and that Do Not Disturb is off.`
      )
  }

  async function remove(device: PushDevice) {
    const result = await removePushDeviceAction(device.id, endpoint ?? undefined)
    if (result.ok) setDevices(result.data)
  }

  const others = devices.filter((device) => !device.thisDevice)

  return (
    <Card id="push">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg font-semibold">
          <BellRingIcon aria-hidden className="size-4 text-muted-foreground" />
          Push reminders
        </CardTitle>
        <CardDescription>
          Reminders on your phone or computer even when Student OS is closed. Which reminders, and how early, are the
          Reminders settings above.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div role="status" className="grid gap-3">
          {status === "loading" && <p className="text-sm text-muted-foreground">Checking this device…</p>}
          {status === "not-configured" && (
            <p className="text-sm text-muted-foreground">Push reminders aren&apos;t set up on this server yet.</p>
          )}
          {status === "unsupported" && (
            <p className="text-sm text-muted-foreground">This browser can&apos;t receive push reminders. Try Chrome, Edge, Firefox or Safari.</p>
          )}
          {status === "install-first" && (
            <p className="text-sm text-muted-foreground">
              On iPhone and iPad, add Student OS to your home screen first: tap <span className="font-medium text-foreground">Share</span>,
              then <span className="font-medium text-foreground">Add to Home Screen</span>. Open Student OS from your home screen and turn
              push reminders on here.
            </p>
          )}
          {status === "blocked" && (
            <p className="text-sm text-muted-foreground">
              Notifications are blocked for Student OS in this browser. Allow them in the browser&apos;s site settings (the icon
              next to the address), then come back.
            </p>
          )}
          {status === "off" && (
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={() => void turnOn()} disabled={busy}>
                <SmartphoneIcon data-icon="inline-start" />
                Turn on for this device
              </Button>
              <p className="text-sm text-muted-foreground">Your browser will ask for permission.</p>
            </div>
          )}
          {status === "on" && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="mr-2 text-sm font-medium text-success">On for this device</p>
              <Button variant="outline" size="sm" onClick={() => void test()} disabled={busy}>
                Send a test
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void turnOff()} disabled={busy}>
                Turn off
              </Button>
            </div>
          )}
        </div>

        {others.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-sm font-medium">Also on</p>
            <ul className="grid gap-1">
              {others.map((device) => (
                <li key={device.id} className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-1.5 text-sm">
                  <SmartphoneIcon aria-hidden className="size-4 text-muted-foreground" />
                  <span className="flex-1">{device.device}</span>
                  <Button variant="ghost" size="icon-sm" aria-label={`Remove ${device.device}`} onClick={() => void remove(device)}>
                    <Trash2Icon />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
