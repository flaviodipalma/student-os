"use client"

import { useEffect, useState } from "react"
import { CheckIcon, ExternalLinkIcon, FileUpIcon, Loader2Icon, PuzzleIcon, RefreshCwIcon } from "lucide-react"
import { lmsSyncStatusAction } from "@/app/actions/integrations"
import { Button, buttonVariants } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { lmsProviderNames, type LmsProviderId } from "@/lib/types"
import { cn } from "@/lib/utils"

// Onboarding's last step: bring in courses. Canvas and Blackboard connect through the
// Student OS browser extension (with the student's own login); without either, a
// syllabus or courses added by hand.

// The published extension's Chrome Web Store page (NEXT_PUBLIC_, it's shown to students).
const STORE_URL = process.env.NEXT_PUBLIC_EXTENSION_STORE_URL

// ---- Choosing Canvas or Blackboard (or skipping) ------------------------------------

export function ChooseSchool({
  onConnect,
  onUploadSyllabus,
  onAddByHand,
  onSkip,
}: {
  onConnect: (provider: LmsProviderId) => void
  onUploadSyllabus: () => void
  onAddByHand: () => void
  onSkip: () => void
}) {
  const [skipping, setSkipping] = useState(false)
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        {(["canvas", "blackboard"] as const).map((provider) => (
          <div key={provider} className="flex flex-col rounded-xl border p-4">
            <span aria-hidden className="flex size-10 items-center justify-center rounded-lg bg-muted text-base font-semibold text-muted-foreground">
              {lmsProviderNames[provider][0]}
            </span>
            <h2 className="mt-3 font-medium">{lmsProviderNames[provider]}</h2>
            <p className="mt-1 flex-1 text-sm text-muted-foreground">
              Your {lmsProviderNames[provider]} courses and assignments, and what you&apos;ve already turned in.
            </p>
            <Button className="mt-4 w-fit" onClick={() => onConnect(provider)}>
              Connect {lmsProviderNames[provider]}
            </Button>
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Your school uses something else, or you&apos;d rather not connect?{" "}
        <Button variant="link" className="h-auto p-0 align-baseline" onClick={() => setSkipping(true)}>
          Skip
        </Button>
      </p>

      <Dialog open={skipping} onOpenChange={setSkipping}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add your classes with a syllabus</DialogTitle>
            <DialogDescription>
              Not connecting Canvas or Blackboard? Upload a syllabus and Student OS adds the course and its deadlines. You
              review everything first.
            </DialogDescription>
          </DialogHeader>
          {/* The three choices stacked, most useful first: they fit at any width. */}
          <div className="grid gap-2">
            <Button size="lg" className="w-full" onClick={onUploadSyllabus}>
              <FileUpIcon data-icon="inline-start" />
              Upload syllabus
            </Button>
            <Button size="lg" variant="outline" className="w-full" onClick={onAddByHand}>
              Add a course by hand
            </Button>
            <Button size="lg" variant="ghost" className="w-full" onClick={onSkip}>
              Skip for now
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---- Getting the extension ------------------------------------------------------------

// The extension marks Student OS pages once it's installed (extension/src/marker.ts).
export function extensionInstalled(): boolean {
  return typeof document !== "undefined" && Boolean(document.documentElement.dataset.studentOsExtension)
}

export function GetExtension({ provider, onInstalled }: { provider: LmsProviderId; onInstalled: () => void }) {
  const name = lmsProviderNames[provider]

  // Move on by itself once the extension is there (checked often: installing takes a moment).
  useEffect(() => {
    if (extensionInstalled()) return onInstalled()
    const check = () => extensionInstalled() && onInstalled()
    document.addEventListener("student-os-extension", check)
    const timer = setInterval(check, 1000)
    return () => {
      document.removeEventListener("student-os-extension", check)
      clearInterval(timer)
    }
  }, [onInstalled])

  return (
    <div className="space-y-5">
      <p className="text-muted-foreground">
        The Student OS extension brings in your {name} courses with your own {name} login. It only reads from {name}, and
        you choose which courses come in.
      </p>
      {STORE_URL ? (
        <a href={STORE_URL} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "lg", className: "h-11 px-5 text-base" })}>
          <PuzzleIcon data-icon="inline-start" />
          Add to Chrome
          <ExternalLinkIcon data-icon="inline-end" />
        </a>
      ) : (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
          The extension isn&apos;t published yet on this server (NEXT_PUBLIC_EXTENSION_STORE_URL isn&apos;t set). For
          development: <code className="font-mono text-xs">npm run build:extension</code>, then load{" "}
          <code className="font-mono text-xs">extension/dist</code> in chrome://extensions (Developer mode, Load unpacked).
        </p>
      )}
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        Waiting for the extension… this page continues on its own once it&apos;s installed.
      </p>
    </div>
  )
}

// ---- The tutorial: the first sync ---------------------------------------------------------

export function SyncTutorial({ provider, onSynced }: { provider: LmsProviderId; onSynced: (courses: number) => void }) {
  const name = lmsProviderNames[provider]
  const [courses, setCourses] = useState<number | null>(null)

  // Waits for the first sync from the extension (it arrives on its own).
  useEffect(() => {
    let active = true
    const check = async () => {
      const status = await lmsSyncStatusAction(provider).catch(() => null)
      if (active && status?.ok && status.data.syncedAt && status.data.courses > 0) {
        active = false
        setCourses(status.data.courses)
        onSynced(status.data.courses)
      }
    }
    void check()
    const timer = setInterval(() => void check(), 3000)
    // The extension also says when a sync is done (extension/src/lms-sync.ts).
    const onSyncEvent = () => void check()
    document.addEventListener("student-os-synced", onSyncEvent)
    return () => {
      active = false
      clearInterval(timer)
      document.removeEventListener("student-os-synced", onSyncEvent)
    }
  }, [provider, onSynced])

  const steps = [
    { title: `Open your ${name} in another tab`, detail: `Log in to ${name} if you aren't already.` },
    {
      title: "Click the Student OS extension",
      detail: "It's in Chrome's toolbar. Don't see it? Click the puzzle-piece icon, then the pin next to Student OS.",
    },
    { title: "Click Sync now", detail: "Then choose your courses for this semester and click Import." },
  ]

  return (
    <div className="space-y-5">
      <ol className="space-y-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex gap-3 rounded-xl border p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
              {index + 1}
            </span>
            <div>
              <p className="font-medium">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>
      <p
        role="status"
        className={cn(
          "flex items-center gap-2 rounded-lg px-4 py-3 text-sm",
          courses ? "bg-success-soft text-success ring-1 ring-success-border" : "bg-muted text-muted-foreground"
        )}
      >
        {courses ? (
          <>
            <CheckIcon aria-hidden className="size-4" />
            Your courses are in! {courses} {courses === 1 ? "course" : "courses"} from {name}.
          </>
        ) : (
          <>
            <RefreshCwIcon aria-hidden className="size-4 animate-spin [animation-duration:2s] motion-reduce:animate-none" />
            Waiting for your {name} courses… this page continues on its own.
          </>
        )}
      </p>
    </div>
  )
}
