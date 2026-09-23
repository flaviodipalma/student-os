"use client"

import { EyeIcon, EyeOffIcon, ExternalLinkIcon, MapPinIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAppStore } from "@/lib/app-store"
import { eventSourceNames, type ExternalEventRecord } from "@/lib/types"

// External calendar events (Canvas, Blackboard) are read-only in Student OS:
// this shows their details, links to the original, and lets the student hide
// them locally. Nothing here changes the event in Canvas or Blackboard.

// Only plain https links are rendered as links (they were checked against the
// student's own LMS address when synced; this is a second check).
export function safeExternalUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" && !parsed.username && !parsed.password ? parsed.toString() : null
  } catch {
    return null
  }
}

// "Tue, Sep 29, 2:00 – 4:00 PM" in the student's time zone (both ends, so an
// event crossing midnight shows both dates).
export function formatExternalTime(record: Pick<ExternalEventRecord, "startsAt" | "endsAt">, timeZone: string | undefined): string {
  const start = new Date(record.startsAt)
  const end = new Date(record.endsAt)
  const day = (date: Date) => date.toLocaleDateString("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" })
  const clock = (date: Date) => date.toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" })
  return day(start) === day(end)
    ? `${day(start)}, ${clock(start)} – ${clock(end)}`
    : `${day(start)}, ${clock(start)} – ${day(end)}, ${clock(end)}`
}

export function ExternalEventDialog({
  eventId,
  open,
  onOpenChange,
}: {
  eventId: string | undefined
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { externalEvents, timeZone, setExternalEventHidden } = useAppStore()
  const record = externalEvents.find((event) => event.id === eventId)
  if (!record) return null
  const source = eventSourceNames[record.source]
  const url = safeExternalUrl(record.url)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{record.title}</DialogTitle>
          <DialogDescription>
            {formatExternalTime(record, timeZone)} · From {source}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {record.location && (
            <p className="flex items-start gap-2">
              <MapPinIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              {record.location}
            </p>
          )}
          {record.description && <p className="whitespace-pre-line text-muted-foreground">{record.description}</p>}
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
            This event comes from your {source} calendar, so it can only be changed in {source}. Student OS updates it
            each time you sync.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            onClick={() => {
              setExternalEventHidden(record.id, !record.hidden)
              onOpenChange(false)
            }}
          >
            {record.hidden ? <EyeIcon data-icon="inline-start" /> : <EyeOffIcon data-icon="inline-start" />}
            {record.hidden ? "Show in Student OS" : "Hide from Student OS"}
          </Button>
          {url && (
            <a href={url} target="_blank" rel="noopener noreferrer" className={buttonVariants()}>
              <ExternalLinkIcon data-icon="inline-start" />
              Open in {source}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Hidden external events, with a way to bring each one back.
export function HiddenEventsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { externalEvents, timeZone, setExternalEventHidden } = useAppStore()
  const hidden = externalEvents.filter((event) => event.hidden)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Hidden events</DialogTitle>
          <DialogDescription>
            Calendar events you hid from Student OS. They&apos;re still in Canvas or Blackboard, and they don&apos;t block
            study time while hidden.
          </DialogDescription>
        </DialogHeader>
        {hidden.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hidden events.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {hidden.map((event) => (
              <li key={event.id} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{event.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatExternalTime(event, timeZone)} · {eventSourceNames[event.source]}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setExternalEventHidden(event.id, false)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
