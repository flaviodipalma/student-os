"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import { PlugZapIcon, RefreshCwIcon, UnplugIcon } from "lucide-react"
import {
  connectCalendarAction,
  disconnectCalendarAction,
  syncCalendarAction,
  type ConnectCalendarState,
} from "@/app/actions/calendar-integrations"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/app-store"
import type { CalendarProviderId } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { CalendarSyncResult } from "@/server/integrations/calendar/calendar-sync"
import type { CalendarIntegrationStatus } from "@/server/integrations/calendar/connections"
import { Logo, Notice, SyncedAgo } from "./integrations-card"

// Integrations > Calendars: Google Calendar and Outlook. Connecting is
// always the student's explicit choice (separate from how they log in), gives
// Student OS read-only access, and brings the events into the one Student OS
// calendar. Only safe summaries reach this component (no tokens).

// Back from Google / Microsoft (?google-calendar=connected, ...): a short code -> a message.
export type CalendarOutcomes = Partial<Record<CalendarProviderId, string>>

function outcomeMessage(name: string, outcome: string): { tone: "success" | "error"; text: string } | undefined {
  const messages: Record<string, { tone: "success" | "error"; text: string }> = {
    connected: { tone: "success", text: `${name} connected. Its events are now in your Student OS calendar.` },
    denied: { tone: "error", text: `${name} access was canceled. Nothing was connected.` },
    permission: { tone: "error", text: `Student OS needs permission to read your ${name} events. Please connect again and allow calendar access.` },
    invalid_state: { tone: "error", text: `That ${name} sign-in expired or didn't match. Please try connecting again.` },
    not_configured: { tone: "error", text: `${name} isn't set up on this server yet.` },
    error: { tone: "error", text: `We couldn't connect ${name}. Please try again.` },
  }
  return Object.hasOwn(messages, outcome) ? messages[outcome] : undefined
}

export function CalendarConnections({
  calendars,
  outcomes,
  timeZone,
}: {
  calendars: CalendarIntegrationStatus[] | null
  outcomes: CalendarOutcomes
  timeZone: string | undefined
}) {
  if (calendars === null) {
    return <p className="text-sm text-muted-foreground">We couldn&apos;t load your calendar connections right now. Please try again later.</p>
  }
  const notices = calendars.flatMap((calendar) => {
    const outcome = outcomes[calendar.provider]
    const message = outcome ? outcomeMessage(calendar.name, outcome) : undefined
    return message ? [{ provider: calendar.provider, ...message }] : []
  })
  return (
    <>
      {notices.map((notice) => (
        <Notice key={notice.provider} tone={notice.tone}>
          {notice.text}
        </Notice>
      ))}
      <ul className="divide-y rounded-lg ring-1 ring-border">
        {calendars.map((calendar) => (
          <li key={calendar.provider} className="space-y-3 px-4 py-4">
            <CalendarRow calendar={calendar} timeZone={timeZone} />
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        Read-only: Student OS never changes your Google or Outlook events. Connecting a calendar is separate from how you
        log in.
      </p>
    </>
  )
}

function CalendarRow({ calendar, timeZone }: { calendar: CalendarIntegrationStatus; timeZone: string | undefined }) {
  const connection = calendar.connection
  const needsAttention = connection && connection.status !== "connected"
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Logo name={calendar.name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {calendar.name}
            {connection && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  needsAttention ? "bg-warning-soft text-warning" : "bg-success-soft text-success"
                )}
              >
                {needsAttention ? "Needs attention" : "Connected"}
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {!connection ? (
              calendar.configured ? (
                `Show your ${calendar.name} events in Student OS so your plan works around them.`
              ) : (
                `${calendar.name} isn't set up on this server yet.`
              )
            ) : (
              <>
                {connection.accountEmail && <span className="break-all">{connection.accountEmail} · </span>}
                {connection.lastSyncedAt ? (
                  <>
                    last synced <SyncedAgo iso={connection.lastSyncedAt} timeZone={timeZone} />
                  </>
                ) : (
                  "not synced yet"
                )}
              </>
            )}
          </p>
        </div>
        {(!connection || connection.status === "needs_reauth") && calendar.configured && (
          <ConnectButton provider={calendar.provider} name={calendar.name} reconnect={Boolean(connection)} />
        )}
      </div>
      {connection?.lastSyncError && <Notice tone="error">{connection.lastSyncError}</Notice>}
      {connection && <ConnectedActions provider={calendar.provider} name={calendar.name} />}
    </>
  )
}

function ConnectButton({ provider, name, reconnect }: { provider: CalendarProviderId; name: string; reconnect: boolean }) {
  const [state, formAction, pending] = useActionState<ConnectCalendarState, FormData>(connectCalendarAction, { error: null })
  return (
    <form action={formAction} className="grid gap-2">
      <input type="hidden" name="provider" value={provider} />
      <Button type="submit" variant={reconnect ? "default" : "outline"} disabled={pending}>
        <PlugZapIcon data-icon="inline-start" />
        {pending ? `Opening ${name}…` : reconnect ? `Reconnect ${name}` : `Connect ${name}`}
      </Button>
      {state.error && (
        <p role="alert" className="text-xs text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function ConnectedActions({ provider, name }: { provider: CalendarProviderId; name: string }) {
  const router = useRouter()
  const { replaceExternalEvents } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<CalendarSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)

  async function sync() {
    setSyncing(true)
    setError(null)
    setResult(null)
    const outcome = await syncCalendarAction(provider).catch(() => null)
    setSyncing(false)
    if (!outcome) return setError("We couldn't reach Student OS. Check your connection and try again.")
    if (!outcome.ok) {
      setError(outcome.error)
      return router.refresh()
    }
    replaceExternalEvents(outcome.data.externalEvents)
    setResult(outcome.data.result)
    router.refresh() // updates "last synced"
  }

  async function disconnect() {
    setWorking(true)
    const outcome = await disconnectCalendarAction(provider).catch(() => null)
    setWorking(false)
    setConfirming(false)
    if (!outcome?.ok) return setError(outcome?.error ?? `We couldn't disconnect ${name}. Please try again.`)
    replaceExternalEvents(outcome.data.externalEvents)
    router.refresh()
  }

  const lines = result
    ? [
        result.added > 0 && `${plural(result.added, "event")} added`,
        result.updated > 0 && `${plural(result.updated, "event")} updated`,
        result.removed > 0 && `${plural(result.removed, "event")} removed (no longer in ${name})`,
        result.skipped > 0 && `${plural(result.skipped, "all-day or untimed item")} not shown`,
        result.failed > 0 && `${plural(result.failed, "event")} couldn't be saved`,
      ].filter(Boolean)
    : []

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={sync} disabled={syncing || working}>
          <RefreshCwIcon data-icon="inline-start" className={cn(syncing && "animate-spin")} />
          {syncing ? `Syncing ${name}…` : "Sync now"}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(true)} disabled={syncing || working}>
          <UnplugIcon data-icon="inline-start" />
          Disconnect
        </Button>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result && (
        <div role="status" className="space-y-1 rounded-lg bg-success-soft px-3 py-3 text-sm ring-1 ring-success-border">
          <p className="font-medium">{name} synced.</p>
          {lines.length > 0 ? (
            <ul className="list-inside list-disc space-y-0.5">
              {lines.map((line) => (
                <li key={String(line)}>{line}</li>
              ))}
            </ul>
          ) : (
            <p>Everything was already up to date.</p>
          )}
        </div>
      )}
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Student OS will forget its access to {name} and remove the {name} events it copied. Your events in {name}{" "}
              aren&apos;t changed, and nothing else in Student OS is (your own events, Canvas and Blackboard, tasks, courses
              and study sessions stay).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={disconnect}>
              Disconnect
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
