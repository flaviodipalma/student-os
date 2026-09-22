"use client"

import { useRef, useState } from "react"
import Link from "next/link"
import { ArrowLeftIcon } from "lucide-react"
import { useCourses } from "@/lib/course-store"
import { requestExtraction } from "@/lib/syllabus/client"
import { SyllabusImportError } from "@/lib/syllabus/errors"
import type { ImportResult } from "@/lib/syllabus/import"
import type { ImportStage } from "@/lib/syllabus/importer"
import { buildReviewDraft, type ReviewDraft } from "@/lib/syllabus/review"
import { useTasks } from "@/lib/task-store"
import { DonePanel } from "./done-panel"
import { FoundPanel } from "./found-panel"
import { ProgressPanel } from "./progress-panel"
import { ReviewPanel } from "./review-panel"
import { UploadPanel } from "./upload-panel"

// The syllabus import flow, one screen at a time:
// upload -> processing -> "we found this" -> review & edit -> confirm -> done.
// Nothing is added to Student OS until the student confirms on the review screen.

type State =
  | { step: "upload"; error?: string }
  | { step: "processing"; fileName: string; stage: "uploading" | ImportStage }
  | { step: "found"; fileName: string; draft: ReviewDraft }
  | { step: "review"; fileName: string; draft: ReviewDraft }
  | { step: "done"; result: ImportResult }

export function SyllabusImporter() {
  const { courses } = useCourses()
  const { tasks, today } = useTasks()
  const [state, setState] = useState<State>({ step: "upload" })
  const abortRef = useRef<AbortController | null>(null)

  async function handleFile(file: File) {
    const controller = new AbortController()
    abortRef.current = controller
    setState({ step: "processing", fileName: file.name, stage: "uploading" })
    try {
      const { extraction } = await requestExtraction(file, today, {
        signal: controller.signal,
        onStage: (stage) => setState({ step: "processing", fileName: file.name, stage }),
      })
      setState({ step: "found", fileName: file.name, draft: buildReviewDraft(extraction, courses, tasks) })
    } catch (error) {
      if (controller.signal.aborted) return setState({ step: "upload" })
      const message =
        error instanceof SyllabusImportError ? error.userMessage : new SyllabusImportError("ai-failed").userMessage
      setState({ step: "upload", error: message })
    }
  }

  const startOver = () => setState({ step: "upload" })

  return (
    <div className="space-y-6">
      <Link
        href="/courses"
        className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <ArrowLeftIcon aria-hidden className="size-4" />
        Courses
      </Link>

      {state.step === "upload" && <UploadPanel error={state.error} onFile={handleFile} />}
      {state.step === "processing" && (
        <ProgressPanel fileName={state.fileName} stage={state.stage} onCancel={() => abortRef.current?.abort()} />
      )}
      {state.step === "found" && (
        <FoundPanel
          draft={state.draft}
          fileName={state.fileName}
          onReview={() => setState({ step: "review", fileName: state.fileName, draft: state.draft })}
          onStartOver={startOver}
        />
      )}
      {state.step === "review" && (
        <ReviewPanel
          initialDraft={state.draft}
          source={{ fileName: state.fileName, itemsFound: state.draft.items.length }}
          onCancel={startOver}
          onImported={(result) => setState({ step: "done", result })}
        />
      )}
      {state.step === "done" && <DonePanel result={state.result} onImportAnother={startOver} />}
    </div>
  )
}
