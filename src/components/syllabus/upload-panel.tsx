"use client"

import { useId, useState } from "react"
import { CircleAlertIcon, FileUpIcon, LockIcon } from "lucide-react"
import { checkFileInBrowser } from "@/lib/syllabus/client"
import { syllabusErrorMessages } from "@/lib/syllabus/errors"
import { cn } from "@/lib/utils"

export function UploadPanel({ error, onFile }: { error?: string; onFile: (file: File) => void }) {
  const inputId = useId()
  const [dragging, setDragging] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  const shownError = localError ?? error

  function pick(file: File | undefined) {
    if (!file) return
    const problem = checkFileInBrowser(file)
    if (problem) return setLocalError(syllabusErrorMessages[problem])
    setLocalError(null)
    onFile(file)
  }

  return (
    <section className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Import a syllabus</h1>
        <p className="mt-1.5 text-muted-foreground">
          Upload your syllabus and we&apos;ll organize the important dates for you.
        </p>
      </header>

      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          pick(e.dataTransfer.files[0])
        }}
        className={cn(
          "flex cursor-pointer flex-col items-center rounded-xl border-2 border-dashed bg-card px-6 py-14 text-center transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/50",
          dragging ? "border-primary bg-primary/5" : "border-foreground/15 hover:border-primary/50 hover:bg-primary/[0.02]"
        )}
      >
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <FileUpIcon className="size-6" />
        </span>
        <span className="mt-4 font-semibold">Upload PDF</span>
        <span className="mt-1 text-sm text-muted-foreground">Choose a file or drag it here. PDF, up to 10 MB.</span>
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            pick(e.target.files?.[0])
            e.target.value = ""
          }}
        />
      </label>

      {shownError && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {shownError}
        </p>
      )}

      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <LockIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        Your syllabus is only used to find your course details and deadlines. It isn&apos;t stored, and
        nothing is added until you&apos;ve reviewed and confirmed it.
      </p>
    </section>
  )
}
