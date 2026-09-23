"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangleIcon, CircleCheckIcon, InfoIcon, PlugZapIcon, RefreshCwIcon, UnplugIcon } from "lucide-react"
import {
  connectCanvasAction,
  connectCanvasFeedAction,
  disconnectLmsAction,
  syncLmsAction,
  type ConnectCanvasFeedState,
  type ConnectCanvasState,
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
import { cn } from "@/lib/utils"
import type { LmsIntegrationStatus } from "@/server/integrations/lms/connections"

// Settings > Integrations. Only safe connection summaries reach this component
// (no tokens). Connecting, syncing and disconnecting go through server actions.

// What Canvas's return to Settings means (?canvas=...), as a friendly message.
const callbackMessages: Record<string, { tone: "success" | "error"; text: string }> = {
  connected: { tone: "success", text: "Canvas connected. Import your Canvas courses and assignments when you're ready." },
  denied: { tone: "error", text: "Canvas authorization was canceled." },
  invalid_state: { tone: "error", text: "That Canvas sign-in expired or didn't match. Please try connecting again." },
  not_configured: { tone: "error", text: "Canvas isn't set up on this server yet." },
  error: { tone: "error", text: "We couldn't connect to Canvas. Please try again." },
}

export function IntegrationsCard({
  integrations,
  canvasOutcome,
  timeZone,
}: {
  integrations: LmsIntegrationStatus[] | null
  canvasOutcome: string | null
  timeZone: string | undefined
}) {
  const notice = canvasOutcome ? callbackMessages[canvasOutcome] : undefined

  return (
    <Card id="integrations">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Integrations</CardTitle>
        <CardDescription>
          Learning management systems. Your courses and assignments come into Student OS as normal courses and tasks,
          and your Planner uses them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
        {integrations === null ? (
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your integrations right now. Please try again later.</p>
        ) : (
          <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
            {integrations.map((integration) => (
              <li key={integration.provider} className="px-4 py-4">
                {integration.provider === "canvas" && integration.available ? (
                  <CanvasRow integration={integration} timeZone={timeZone} />
                ) : (
                  <ComingSoonRow integration={integration} />
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

function Notice({ tone, children }: { tone: "success" | "error" | "info"; children: React.ReactNode }) {
  const Icon = tone === "success" ? CircleCheckIcon : tone === "error" ? AlertTriangleIcon : InfoIcon
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg px-3 py-2 text-sm",
        tone === "success" && "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200",
        tone === "error" && "bg-red-50 text-red-900 ring-1 ring-red-200",
        tone === "info" && "bg-muted text-foreground"
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

function Logo({ name }: { name: string }) {
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

function CanvasRow({ integration, timeZone }: { integration: LmsIntegrationStatus; timeZone: string | undefined }) {
  const connection = integration.connection
  const viaFeed = connection?.method === "calendar_feed"
  const needsAttention = connection && connection.status !== "connected"
  const lastSynced = connection?.lastSyncedAt
    ? new Date(connection.lastSyncedAt).toLocaleString("en-US", {
        timeZone,
        month: "long",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : null

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Logo name="Canvas" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            Canvas
            {connection && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                  needsAttention ? "bg-amber-100 text-amber-900" : "bg-emerald-100 text-emerald-900"
                )}
              >
                {needsAttention ? "Needs attention" : "Connected"}
              </span>
            )}
          </p>
          <p className="text-sm text-muted-foreground">
            {!connection
              ? "Bring in your Canvas courses and assignment deadlines."
              : needsAttention
                ? "Connection needs attention."
                : [viaFeed ? "Through your calendar feed" : "Signed in with Canvas", lastSynced ? `last synced ${lastSynced}` : "nothing imported yet"].join(" · ")}
          </p>
        </div>
      </div>

      {needsAttention && connection.lastSyncError && <Notice tone="error">{connection.lastSyncError}</Notice>}

      {!connection ? (
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
          <DisconnectButton />
        </div>
      ) : (
        <ConnectedActions firstSync={!connection.lastSyncedAt} />
      )}
    </div>
  )
}

function ConnectCanvasFeedForm({ reconnect = false }: { reconnect?: boolean }) {
  const router = useRouter()
  // Kept in the browser only, so a mistake doesn't clear the field (the server never echoes it back).
  const [feedUrl, setFeedUrl] = useState("")
  const [state, formAction, pending] = useActionState<ConnectCanvasFeedState, FormData>(
    async (previous, form) => {
      const next = await connectCanvasFeedAction(previous, form)
      if (next.connected) router.refresh()
      return next
    },
    { error: null, connected: false }
  )
  return (
    <form action={formAction} className="grid gap-3">
      <Field label="Your Canvas Calendar Feed link" htmlFor="canvas-feed-url" error={state.error ?? undefined}>
        <Input
          id="canvas-feed-url"
          name="feedUrl"
          type="url"
          value={feedUrl}
          onChange={(e) => setFeedUrl(e.target.value)}
          placeholder="https://school.instructure.com/feeds/calendars/user_….ics"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        In Canvas, open <span className="font-medium text-foreground">Calendar</span>, then{" "}
        <span className="font-medium text-foreground">Calendar Feed</span> (bottom right), and copy the link. It&apos;s
        private: Student OS stores it encrypted and never shows it again. It brings in assignments with due dates.
      </p>
      <Button type="submit" disabled={pending} className="w-fit">
        <PlugZapIcon data-icon="inline-start" />
        {pending ? "Checking the feed…" : reconnect ? "Update feed link" : "Connect Canvas"}
      </Button>
    </form>
  )
}

function ConnectCanvasForm({ reconnect }: { reconnect: boolean }) {
  const [state, formAction, pending] = useActionState<ConnectCanvasState, FormData>(connectCanvasAction, { error: null })
  const [canvasUrl, setCanvasUrl] = useState("")
  return (
    <form action={formAction} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <Field label="Your school's Canvas address" htmlFor="canvas-url" error={state.error ?? undefined}>
        <Input
          id="canvas-url"
          name="canvasUrl"
          value={canvasUrl}
          onChange={(e) => setCanvasUrl(e.target.value)}
          placeholder="school.instructure.com"
          autoComplete="url"
          inputMode="url"
          spellCheck={false}
          required
        />
      </Field>
      <Button type="submit" disabled={pending}>
        <PlugZapIcon data-icon="inline-start" />
        {pending ? "Opening Canvas…" : reconnect ? "Reconnect" : "Connect Canvas"}
      </Button>
    </form>
  )
}

function ConnectedActions({ firstSync }: { firstSync: boolean }) {
  const router = useRouter()
  const { replaceCoursesAndTasks } = useAppStore()
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<LmsSyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function sync() {
    setSyncing(true)
    setError(null)
    const outcome = await syncLmsAction("canvas").catch(() => null)
    setSyncing(false)
    if (!outcome) return setError("We couldn't reach Student OS. Check your connection and try again.")
    if (!outcome.ok) {
      setError(outcome.error)
      return router.refresh()
    }
    replaceCoursesAndTasks(outcome.data.courses, outcome.data.tasks)
    setResult(outcome.data.result)
    router.refresh() // updates "Last synced"
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={sync} disabled={syncing}>
          <RefreshCwIcon data-icon="inline-start" className={cn(syncing && "animate-spin")} />
          {syncing ? "Syncing with Canvas…" : firstSync ? "Import Canvas data" : "Sync now"}
        </Button>
        <DisconnectButton />
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {result && <SyncSummary result={result} />}
    </div>
  )
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

function SyncSummary({ result }: { result: LmsSyncResult }) {
  const issues = result.errors.length + result.conflicts.length > 0
  const lines = [
    result.coursesCreated > 0 && `${plural(result.coursesCreated, "course")} added`,
    result.coursesLinked > 0 && `${plural(result.coursesLinked, "existing course")} linked to Canvas`,
    result.coursesUpdated > 0 && `${plural(result.coursesUpdated, "course")} updated`,
    result.assignmentsCreated > 0 && `${plural(result.assignmentsCreated, "assignment")} added as tasks`,
    result.assignmentsLinked > 0 && `${plural(result.assignmentsLinked, "existing task")} linked to Canvas`,
    result.assignmentsUpdated > 0 && `${plural(result.assignmentsUpdated, "assignment")} updated`,
    result.assignmentsWithoutDueDate > 0 &&
      `${plural(result.assignmentsWithoutDueDate, "assignment")} without a due date in Canvas weren't imported`,
  ].filter(Boolean)

  return (
    <div
      role="status"
      className={cn(
        "space-y-2 rounded-lg px-3 py-3 text-sm ring-1",
        issues ? "bg-amber-50 ring-amber-200" : "bg-emerald-50 ring-emerald-200"
      )}
    >
      <p className="font-medium">{issues ? "Canvas sync completed with some issues." : "Canvas sync complete."}</p>
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
                {conflict.title}: you set the {fieldLabel[conflict.field]} to {conflict.studentValue ?? "nothing"}; Canvas
                now says {conflict.lmsValue ?? "nothing"}.
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.missing.length > 0 && (
        <div>
          <p className="font-medium">No longer in Canvas (kept in Student OS):</p>
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

function DisconnectButton() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  async function disconnect() {
    setWorking(true)
    const outcome = await disconnectLmsAction("canvas").catch(() => null)
    setWorking(false)
    setOpen(false)
    if (!outcome?.ok) return setError(outcome?.error ?? "We couldn't disconnect Canvas. Please try again.")
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
            <AlertDialogTitle>Disconnect Canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              Student OS will stop syncing with Canvas and forget its access. Courses and tasks you already imported stay
              in Student OS.
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
