"use client"

import { useActionState, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, PlugZapIcon, RefreshCwIcon, UnplugIcon } from "lucide-react"
import {
  connectBlackboardAction,
  connectBlackboardFeedAction,
  connectCanvasAction,
  connectCanvasFeedAction,
  disconnectLmsAction,
  syncLmsAction,
  type ConnectCanvasFeedState,
  type ConnectLmsState,
} from "@/app/actions/integrations"
import { Field } from "@/components/form-fields"
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
import { Input } from "@/components/ui/input"
import { useAppStore } from "@/lib/app-store"
import type { LmsSyncResult } from "@/lib/lms/types"
import type { LmsProviderId } from "@/lib/types"
import { cn } from "@/lib/utils"
import type { CalendarIntegrationStatus } from "@/server/integrations/calendar/connections"
import type { LmsIntegrationStatus } from "@/server/integrations/lms/connections"
import { CalendarConnections, type CalendarOutcomes } from "./calendar-connections"

// The Integrations page (/integrations). Only safe connection summaries reach this component
// (no tokens). Connecting, syncing and disconnecting go through server actions.

// What the LMS's return to Integrations means (?canvas=..., ?blackboard=...), as a friendly message.
function callbackMessage(name: string, outcome: string): { tone: "success" | "error"; text: string } | undefined {
  const messages: Record<string, { tone: "success" | "error"; text: string }> = {
    connected: { tone: "success", text: `${name} connected. Import your ${name} courses and assignments when you're ready.` },
    denied: { tone: "error", text: `${name} authorization was canceled.` },
    invalid_state: { tone: "error", text: `That ${name} sign-in expired or didn't match. Please try connecting again.` },
    not_configured: { tone: "error", text: `${name} isn't set up on this server yet.` },
    not_approved: {
      tone: "error",
      text: `Your school hasn't enabled Student OS in ${name} yet. Ask your ${name} administrator to approve it.`,
    },
    error: { tone: "error", text: `We couldn't connect to ${name}. Please try again.` },
  }
  return Object.hasOwn(messages, outcome) ? messages[outcome] : undefined
}

export type IntegrationOutcomes = Partial<Record<LmsProviderId, string>>

export function IntegrationsCard({
  integrations,
  outcomes,
  timeZone,
  calendars,
  calendarOutcomes = {},
}: {
  integrations: LmsIntegrationStatus[] | null
  outcomes: IntegrationOutcomes
  timeZone: string | undefined
  // Personal calendars (Google Calendar, Outlook).
  calendars?: CalendarIntegrationStatus[] | null
  calendarOutcomes?: CalendarOutcomes
}) {
  const notices = (integrations ?? []).flatMap((integration) => {
    const outcome = outcomes[integration.provider]
    const message = outcome ? callbackMessage(integration.name, outcome) : undefined
    return message ? [{ provider: integration.provider, ...message }] : []
  })

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
            <h3 className="pt-3 text-sm font-semibold">Learning management systems</h3>
            <p className="-mt-2 text-sm text-muted-foreground">
              Your courses and assignments come into Student OS as normal courses and tasks.
            </p>
          </>
        )}
        {notices.map((notice) => (
          <Notice key={notice.provider} tone={notice.tone}>
            {notice.text}
          </Notice>
        ))}
        {integrations === null ? (
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your integrations right now. Please try again later.</p>
        ) : (
          <ul className="divide-y rounded-lg ring-1 ring-border">
            {integrations.map((integration) => (
              <li key={integration.provider} className="px-4 py-4">
                {!integration.available ? (
                  <ComingSoonRow integration={integration} />
                ) : integration.provider === "canvas" ? (
                  <CanvasRow integration={integration} timeZone={timeZone} />
                ) : (
                  <BlackboardRow integration={integration} timeZone={timeZone} />
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Student OS only reads from your LMS (through your private calendar feed, or your school&apos;s official
          sign-in) and never asks for your LMS password.
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

function ComingSoonRow({ integration }: { integration: LmsIntegrationStatus }) {
  const statusId = `lms-${integration.provider}-status`
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Logo name={integration.name} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {integration.name}
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Coming soon</span>
        </p>
        <p id={statusId} className="text-sm text-muted-foreground">
          {integration.name} integration coming soon.
        </p>
      </div>
      <Button variant="outline" disabled aria-describedby={statusId} className="disabled:cursor-not-allowed">
        <PlugZapIcon data-icon="inline-start" />
        Connect (coming soon)
      </Button>
    </div>
  )
}

// Name, status badge, and how/when it last synced.
function ProviderHeader({
  integration,
  timeZone,
  pitch,
  method,
}: {
  integration: LmsIntegrationStatus
  timeZone: string | undefined
  pitch: string
  method: string
}) {
  const connection = integration.connection
  const needsAttention = connection && connection.status !== "connected"
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Logo name={integration.name} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          {integration.name}
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
          {!connection
            ? pitch
            : needsAttention
              ? "Connection needs attention."
              : (
                <>
                  {method} ·{" "}
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
  )
}

function CanvasRow({ integration, timeZone }: { integration: LmsIntegrationStatus; timeZone: string | undefined }) {
  const connection = integration.connection
  const viaFeed = connection?.method === "calendar_feed"
  const viaExtension = connection?.method === "extension"
  const needsAttention = connection && connection.status !== "connected"

  return (
    <div className="space-y-3">
      <ProviderHeader
        integration={integration}
        timeZone={timeZone}
        pitch="Bring in your Canvas courses and assignment deadlines."
        method={viaExtension ? "Through the browser extension" : viaFeed ? "Through your calendar feed" : "Signed in with Canvas"}
      />

      {needsAttention && connection.lastSyncError && <Notice tone="error">{connection.lastSyncError}</Notice>}

      {viaExtension ? (
        // Only the extension can read Canvas for this connection (with the student's own login).
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            To sync, open Canvas, click the Student OS extension, then click{" "}
            <span className="font-medium text-foreground">Sync now</span>. You choose which courses come in.
          </p>
          <DisconnectButton
            provider="canvas"
            name="Canvas"
            description="Student OS will stop syncing with Canvas until you click Sync now in the extension again. Courses and tasks you already imported stay in Student OS."
          />
        </div>
      ) : !connection ? (
        <div className="space-y-4">
          <ConnectCanvasFeedForm />
          {integration.configured && (
            <div className="border-t pt-4">
              <p className="mb-2 text-sm text-muted-foreground">
                Or sign in with Canvas (if your school has approved Student OS):
              </p>
              <ConnectCanvasForm reconnect={false} />
            </div>
          )}
        </div>
      ) : connection.status === "needs_reauth" ? (
        <div className="space-y-3">
          {viaFeed || !integration.configured ? <ConnectCanvasFeedForm reconnect /> : <ConnectCanvasForm reconnect />}
          <DisconnectButton provider="canvas" name="Canvas" />
        </div>
      ) : (
        <ConnectedActions provider="canvas" name="Canvas" firstSync={!connection.lastSyncedAt} />
      )}
    </div>
  )
}

// Blackboard Learn: the student's calendar link (works everywhere), or signing
// in through the school's Blackboard (only where the school has approved Student OS).
function BlackboardRow({ integration, timeZone }: { integration: LmsIntegrationStatus; timeZone: string | undefined }) {
  const connection = integration.connection
  const viaFeed = connection?.method === "calendar_feed"
  const needsAttention = connection && connection.status !== "connected"

  return (
    <div className="space-y-3">
      <ProviderHeader
        integration={integration}
        timeZone={timeZone}
        pitch="Bring in your Blackboard assignment deadlines."
        method={viaFeed ? "Through your calendar link" : "Signed in with Blackboard"}
      />

      {needsAttention && connection.lastSyncError && <Notice tone="error">{connection.lastSyncError}</Notice>}

      {!connection ? (
        <div className="space-y-4">
          <ConnectBlackboardFeedForm />
          {integration.configured && (
            <div className="border-t pt-4">
              <p className="mb-2 text-sm text-muted-foreground">
                Or sign in with Blackboard (if your school has approved Student OS). This also brings in your course
                names and what you&apos;ve already turned in:
              </p>
              <ConnectBlackboardForm reconnect={false} />
            </div>
          )}
        </div>
      ) : connection.status === "needs_reauth" ? (
        <div className="space-y-3">
          {viaFeed || !integration.configured ? <ConnectBlackboardFeedForm reconnect /> : <ConnectBlackboardForm reconnect />}
          <DisconnectButton provider="blackboard" name="Blackboard" />
        </div>
      ) : (
        <ConnectedActions provider="blackboard" name="Blackboard" firstSync={!connection.lastSyncedAt} />
      )}
    </div>
  )
}

function ConnectCanvasFeedForm({ reconnect = false }: { reconnect?: boolean }) {
  return (
    <ConnectFeedForm
      action={connectCanvasFeedAction}
      name="Canvas"
      label="Your Canvas Calendar Feed link"
      id="canvas-feed-url"
      placeholder="https://school.instructure.com/feeds/calendars/user_….ics"
      reconnect={reconnect}
      help={
        <>
          In Canvas, open <span className="font-medium text-foreground">Calendar</span>, then{" "}
          <span className="font-medium text-foreground">Calendar Feed</span> (bottom right), and copy the link. It&apos;s
          private: Student OS stores it encrypted and never shows it again. It brings in assignments with due dates.
        </>
      }
    />
  )
}

function ConnectBlackboardFeedForm({ reconnect = false }: { reconnect?: boolean }) {
  return (
    <ConnectFeedForm
      action={connectBlackboardFeedAction}
      name="Blackboard"
      label="Your Blackboard calendar link"
      id="blackboard-feed-url"
      placeholder="https://school.blackboard.com/webapps/calendar/calendarFeed/…/learn.ics"
      reconnect={reconnect}
      help={
        <>
          In Blackboard, open <span className="font-medium text-foreground">Calendar</span>, then{" "}
          <span className="font-medium text-foreground">Calendar Settings</span>, the{" "}
          <span className="font-medium text-foreground">⋯</span> menu, and{" "}
          <span className="font-medium text-foreground">Share Calendar</span>, and copy the link. It&apos;s private:
          Student OS stores it encrypted and never shows it again. It brings in upcoming due dates; Blackboard&apos;s
          calendar doesn&apos;t say which course each one is for, so they go into a &quot;Blackboard&quot; course you can
          rename or sort.
        </>
      }
    />
  )
}

// A private calendar-feed link, checked and saved on the server.
function ConnectFeedForm({
  action,
  name,
  label,
  id,
  placeholder,
  help,
  reconnect,
}: {
  action: (previous: ConnectCanvasFeedState, form: FormData) => Promise<ConnectCanvasFeedState>
  name: string
  label: string
  id: string
  placeholder: string
  help: React.ReactNode
  reconnect: boolean
}) {
  const router = useRouter()
  // Kept in the browser only, so a mistake doesn't clear the field (the server never echoes it back).
  const [feedUrl, setFeedUrl] = useState("")
  const [state, formAction, pending] = useActionState<ConnectCanvasFeedState, FormData>(
    async (previous, form) => {
      const next = await action(previous, form)
      if (next.connected) router.refresh()
      return next
    },
    { error: null, connected: false }
  )
  return (
    <form action={formAction} className="grid gap-3">
      <Field label={label} htmlFor={id} error={state.error ?? undefined}>
        <Input
          id={id}
          name="feedUrl"
          type="url"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>
      <p className="text-xs text-muted-foreground">{help}</p>
      <Button type="submit" disabled={pending} className="w-fit">
        <PlugZapIcon data-icon="inline-start" />
        {pending ? "Checking the feed…" : reconnect ? "Update feed link" : `Connect ${name}`}
      </Button>
    </form>
  )
}

function ConnectCanvasForm({ reconnect }: { reconnect: boolean }) {
  return (
    <ConnectLmsForm
      action={connectCanvasAction}
      name="Canvas"
      field="canvasUrl"
      placeholder="school.instructure.com"
      reconnect={reconnect}
    />
  )
}

function ConnectBlackboardForm({ reconnect }: { reconnect: boolean }) {
  return (
    <ConnectLmsForm
      action={connectBlackboardAction}
      name="Blackboard"
      field="blackboardUrl"
      placeholder="school.blackboard.com"
      reconnect={reconnect}
    />
  )
}

// The school's LMS address, then off to the LMS to sign in (server action + redirect).
function ConnectLmsForm({
  action,
  name,
  field,
  placeholder,
  reconnect,
}: {
  action: (previous: ConnectLmsState, form: FormData) => Promise<ConnectLmsState>
  name: string
  field: string
  placeholder: string
  reconnect: boolean
}) {
  const [state, formAction, pending] = useActionState<ConnectLmsState, FormData>(action, { error: null })
  const [address, setAddress] = useState("")
  const id = `${name.toLowerCase()}-url`
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <Field label={`Your school's ${name} address`} htmlFor={id} error={state.error ?? undefined}>
        <Input
          id={id}
          name={field}
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder={placeholder}
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          required
        />
      </Field>
      <Button type="submit" disabled={pending}>
        <PlugZapIcon data-icon="inline-start" />
        {pending ? `Opening ${name}…` : reconnect ? "Reconnect" : `Connect ${name}`}
      </Button>
    </form>
  )
}

function ConnectedActions({ provider, name, firstSync }: { provider: LmsProviderId; name: string; firstSync: boolean }) {
  const router = useRouter()
  const { replaceCoursesAndTasks, replaceExternalEvents } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<LmsSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sync() {
    setSyncing(true)
    setError(null)
    const outcome = await syncLmsAction(provider).catch(() => null)
    setSyncing(false)
    if (!outcome) return setError("We couldn't reach Student OS. Check your connection and try again.")
    if (!outcome.ok) {
      setError(outcome.error)
      return router.refresh()
    }
    replaceCoursesAndTasks(outcome.data.courses, outcome.data.tasks)
    replaceExternalEvents(outcome.data.externalEvents)
    setResult(outcome.data.result)
    router.refresh() // updates "Last synced"
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={sync} disabled={syncing}>
          <RefreshCwIcon data-icon="inline-start" className={cn(syncing && "animate-spin")} />
          {syncing ? `Syncing with ${name}…` : firstSync ? `Import ${name} data` : "Sync now"}
        </Button>
        <DisconnectButton provider={provider} name={name} />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result && <SyncSummary result={result} name={name} />}
    </div>
  )
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function SyncSummary({ result, name }: { result: LmsSyncResult; name: string }) {
  const issues = result.errors.length + result.conflicts.length > 0
  const lines = [
    result.coursesCreated > 0 && `${plural(result.coursesCreated, "course")} added`,
    result.coursesLinked > 0 && `${plural(result.coursesLinked, "existing course")} linked to ${name}`,
    result.coursesUpdated > 0 && `${plural(result.coursesUpdated, "course")} updated`,
    result.assignmentsCreated > 0 && `${plural(result.assignmentsCreated, "assignment")} added as tasks`,
    result.assignmentsLinked > 0 && `${plural(result.assignmentsLinked, "existing task")} linked to ${name}`,
    result.assignmentsUpdated > 0 && `${plural(result.assignmentsUpdated, "assignment")} updated`,
    result.assignmentsCompleted > 0 &&
      `${plural(result.assignmentsCompleted, "task")} marked done (submitted in ${name})`,
    result.assignmentsWithoutDueDate > 0 &&
      `${plural(result.assignmentsWithoutDueDate, "assignment")} without a due date in ${name} weren't imported`,
    result.coursesSkipped > 0 && `${plural(result.coursesSkipped, "course")} skipped (see below)`,
    (result.calendarEvents?.added ?? 0) > 0 && `${plural(result.calendarEvents!.added, "calendar event")} added`,
    (result.calendarEvents?.updated ?? 0) > 0 && `${plural(result.calendarEvents!.updated, "calendar event")} updated`,
    (result.calendarEvents?.removed ?? 0) > 0 &&
      `${plural(result.calendarEvents!.removed, "calendar event")} no longer in ${name} (removed from your calendar)`,
    (result.calendarEvents?.skipped ?? 0) > 0 &&
      `${plural(result.calendarEvents!.skipped, "all-day or untimed calendar item")} not shown`,
  ].filter(Boolean)

  return (
    <div
      role="status"
      className={cn(
        "space-y-2 rounded-lg px-3 py-3 text-sm ring-1",
        issues ? "bg-warning-soft ring-warning-border" : "bg-success-soft ring-success-border"
      )}
    >
      <p className="font-medium">{issues ? `${name} sync completed with some issues.` : `${name} sync complete.`}</p>
      {lines.length > 0 ? (
        <ul className="list-inside list-disc space-y-0.5">
          {lines.map((line) => (
            <li key={String(line)}>{line}</li>
          ))}
        </ul>
      ) : (
        <p>Everything was already up to date.</p>
      )}
      {result.conflicts.length > 0 && (
        <div>
          <p className="font-medium">Your changes were kept:</p>
          <ul className="list-inside list-disc space-y-0.5">
            {result.conflicts.map((conflict) => (
              <li key={`${conflict.taskId}-${conflict.field}`}>
                {`${conflict.title}: you set the ${fieldLabel[conflict.field]} to ${conflict.studentValue ?? "nothing"}; ${name} now says ${conflict.lmsValue ?? "nothing"}.`}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.missingCourses.length > 0 && (
        <div>
          <p className="font-medium">Courses no longer in {name} (kept in Student OS):</p>
          <ul className="list-inside list-disc space-y-0.5">
            {result.missingCourses.map((course) => (
              <li key={course.courseId}>{course.name}</li>
            ))}
          </ul>
        </div>
      )}
      {result.missing.length > 0 && (
        <div>
          <p className="font-medium">No longer in {name} (kept in Student OS):</p>
          <ul className="list-inside list-disc space-y-0.5">
            {result.missing.map((task) => (
              <li key={task.taskId}>{task.title}</li>
            ))}
          </ul>
        </div>
      )}
      {result.errors.length > 0 && (
        <ul className="list-inside list-disc space-y-0.5">
          {result.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

const fieldLabel = { title: "title", description: "description", dueDate: "due date", dueTime: "due time" } as const

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
