"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, PuzzleIcon, UnplugIcon } from "lucide-react"
import { disconnectLmsAction } from "@/app/actions/integrations"
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { LmsProviderId } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { CalendarIntegrationStatus } from "@/server/integrations/calendar/connections"
import type { LmsIntegrationStatus } from "@/server/integrations/lms/connections"
import { CalendarConnections, type CalendarOutcomes } from "./calendar-connections"

// The Integrations page (/integrations). Only safe connection summaries reach this
// component. Personal calendars connect here; Canvas and Blackboard connect through
// the Student OS browser extension (with the student's own LMS login), so for them
// this page only shows the status and a way to disconnect.

export function IntegrationsCard({
  integrations,
  timeZone,
  calendars,
  calendarOutcomes = {},
}: {
  integrations: LmsIntegrationStatus[] | null
  timeZone: string | undefined
  // Personal calendars (Google Calendar, Outlook).
  calendars?: CalendarIntegrationStatus[] | null
  calendarOutcomes?: CalendarOutcomes
}) {
  return (
    <Card id="integrations">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Integrations</CardTitle>
        <CardDescription>
          Connected calendars and learning management systems. Everything shows up in one Student OS calendar, and your
          Planner works around it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {calendars !== undefined && (
          <>
            <h3 className="text-sm font-semibold">Calendars</h3>
            <CalendarConnections calendars={calendars} outcomes={calendarOutcomes} timeZone={timeZone} />
          </>
        )}
        <h3 id="browser-extension" className={cn("text-sm font-semibold", calendars !== undefined && "pt-3")}>
          Canvas and Blackboard
        </h3>
        <div className="-mt-1 space-y-2 text-sm text-muted-foreground">
          <p>
            Connect with the Student OS browser extension. It uses your own Canvas or Blackboard login (no school approval
            needed) and brings in the courses you choose, their assignments, and what you&apos;ve already turned in.
          </p>
          <ol className="list-inside list-decimal space-y-1">
            <li>Install the Student OS extension in Chrome, and stay logged in to Student OS there.</li>
            <li>
              Open your Canvas or Blackboard, click <PuzzleIcon aria-label="the extension" className="inline size-4 align-text-bottom" />{" "}
              Student OS, then <span className="font-medium text-foreground">Sync now</span>, and choose your courses.
            </li>
            <li>Optional: turn on automatic sync in the extension, so opening Canvas or Blackboard keeps Student OS up to date.</li>
          </ol>
        </div>
        {integrations === null ? (
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your integrations right now. Please try again later.</p>
        ) : (
          <ul className="divide-y rounded-lg ring-1 ring-border">
            {integrations.map((integration) => (
              <li key={integration.provider} className="px-4 py-4">
                <LmsRow integration={integration} timeZone={timeZone} />
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Student OS only reads from Canvas and Blackboard, never asks for your password, and stores nothing that could
          sign in to them.
        </p>
      </CardContent>
    </Card>
  )
}

export function Notice({ tone, children }: { tone: "success" | "error" | "info"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CircleCheckIcon : tone === "error" ? AlertTriangleIcon : InfoIcon
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
        tone === "success" && "bg-success-soft text-success ring-1 ring-success-border",
        tone === "error" && "bg-danger-soft text-danger ring-1 ring-danger-border",
        tone === "info" && "bg-muted text-foreground"
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

export function Logo({ name }: { name: string }) {
  return (
    <span
      aria-hidden
      className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground"
    >
      {name[0]}
    </span>
  )
}

// One LMS: its status (connected through the extension, or how to connect), and
// Disconnect. Only the extension can sync it.
function LmsRow({ integration, timeZone }: { integration: LmsIntegrationStatus; timeZone: string | undefined }) {
  const connection = integration.connection
  const needsAttention = connection && connection.status !== "connected"
  const { name } = integration
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Logo name={name} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {name}
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
              `Not connected · open ${name}, click the Student OS extension, then Sync now.`
            ) : (
              <>
                Through the browser extension ·{" "}
                {connection.lastSyncedAt ? (
                  <>
                    last synced <SyncedAgo iso={connection.lastSyncedAt} timeZone={timeZone} />
                  </>
                ) : (
                  "nothing imported yet"
                )}
              </>
            )}
          </p>
        </div>
      </div>
      {needsAttention && connection.lastSyncError && <Notice tone="error">{connection.lastSyncError}</Notice>}
      {connection && (
        <DisconnectButton
          provider={integration.provider}
          name={name}
          description={`Student OS will stop syncing with ${name} until you click Sync now in the extension again. Courses and tasks you already imported stay in Student OS.`}
        />
      )}
    </div>
  )
}

function DisconnectButton({ provider, name, description }: { provider: LmsProviderId; name: string; description?: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function disconnect() {
    setWorking(true)
    const outcome = await disconnectLmsAction(provider).catch(() => null)
    setWorking(false)
    setOpen(false)
    if (!outcome?.ok) return setError(outcome?.error ?? `We couldn't disconnect ${name}. Please try again.`)
    router.refresh()
  }

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} disabled={working}>
        <UnplugIcon data-icon="inline-start" />
        Disconnect
      </Button>
      {error && <Notice tone="error">{error}</Notice>}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {description ??
                `Student OS will stop syncing with ${name} and forget its access. Courses and tasks you already imported stay in Student OS.`}
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
    </>
  )
}

// "just now", "5 minutes ago", "3 hours ago", or the date. Rendered as the date
// first (server and browser agree on it), then relative once in the browser.
export function SyncedAgo({ iso, timeZone }: { iso: string; timeZone: string | undefined }) {
  const absolute = new Date(iso).toLocaleString("en-US", {
    timeZone,
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })
  const [text, setText] = useState(absolute)
  useEffect(() => {
    const update = () => setText(formatSyncedAgo(new Date(iso), new Date(), absolute))
    const first = setTimeout(update, 0)
    const timer = setInterval(update, 30_000)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [iso, absolute])
  return (
    <time dateTime={iso} title={absolute}>
      {text}
    </time>
  )
}

export function formatSyncedAgo(then: Date, now: Date, fallback: string): string {
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} ${hours === 1 ? "hour" : "hours"} ago`
  return fallback
}
