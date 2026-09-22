"use client"

import { CheckIcon, FileTextIcon, LoaderCircleIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { ImportStage } from "@/lib/syllabus/importer"
import { cn } from "@/lib/utils"

const steps: { stage: "uploading" | ImportStage; label: string; hint?: string }[] = [
  { stage: "uploading", label: "Uploading your syllabus" },
  { stage: "reading", label: "Reading the PDF" },
  { stage: "analyzing", label: "Finding course details and deadlines", hint: "This can take up to a minute." },
  { stage: "checking", label: "Checking the results" },
]

export function ProgressPanel({
  fileName,
  stage,
  onCancel,
}: {
  fileName: string
  stage: "uploading" | ImportStage
  onCancel: () => void
}) {
  const current = steps.findIndex((s) => s.stage === stage)

  return (
    <section aria-labelledby="progress-title" className="rounded-xl bg-card p-6 ring-1 ring-foreground/10 sm:p-8">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
          <FileTextIcon aria-hidden className="size-5 text-muted-foreground" />
        </span>
        <div className="min-w-0">
          <h1 id="progress-title" className="font-semibold">
            Importing your syllabus
          </h1>
          <p className="truncate text-sm text-muted-foreground">{fileName}</p>
        </div>
      </div>

      <ol className="mt-6 space-y-4" aria-live="polite">
        {steps.map((step, index) => {
          const done = index < current
          const active = index === current
          return (
            <li key={step.stage} className="flex items-start gap-3">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-primary/10 text-primary",
                  !done && !active && "bg-muted text-muted-foreground"
                )}
              >
                {done ? (
                  <CheckIcon aria-hidden className="size-3.5" />
                ) : active ? (
                  <LoaderCircleIcon aria-hidden className="size-3.5 animate-spin" />
                ) : (
                  <span className="size-1.5 rounded-full bg-current" />
                )}
              </span>
              <div>
                <p className={cn("text-sm", active ? "font-medium" : done ? "" : "text-muted-foreground")}>
                  {step.label}
                  {done && <span className="sr-only"> (done)</span>}
                </p>
                {active && step.hint && <p className="text-xs text-muted-foreground">{step.hint}</p>}
              </div>
            </li>
          )
        })}
      </ol>

      <Button variant="outline" className="mt-6" onClick={onCancel}>
        Cancel
      </Button>
    </section>
  )
}
