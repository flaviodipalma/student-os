"use client"

import { CircleAlertIcon, CopyIcon, SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useCourses } from "@/lib/course-store"
import { findDraftDuplicates, type ReviewDraft } from "@/lib/syllabus/review"
import { useTasks } from "@/lib/task-store"
import { typeLabel } from "@/lib/tasks"
import type { TaskType } from "@/lib/types"

export function FoundPanel({
  draft,
  fileName,
  onReview,
  onStartOver,
}: {
  draft: ReviewDraft
  fileName: string
  onReview: () => void
  onStartOver: () => void
}) {
  const { tasks } = useTasks()
  const { getCourse } = useCourses()
  const existing = draft.target.kind === "existing" ? getCourse(draft.target.courseId) : undefined
  const duplicates = findDraftDuplicates(draft, tasks).size
  const toCheck = draft.items.filter((item) => item.needsReview).length
  const count = draft.items.length

  const byType = new Map<TaskType, number>()
  for (const item of draft.items) byType.set(item.type, (byType.get(item.type) ?? 0) + 1)
  const courseTitle = [draft.course.code, draft.course.name].filter(Boolean).join(" — ") || "Course details not found"

  return (
    <section aria-labelledby="found-title" className="space-y-6">
      <header>
        <p className="text-sm font-medium text-muted-foreground">{fileName}</p>
        <h1 id="found-title" className="mt-0.5 text-2xl font-semibold tracking-tight md:text-3xl">
          We found this
        </h1>
      </header>

      <div className="rounded-xl bg-primary/[0.05] p-6 ring-1 ring-primary/15">
        <p className="text-sm font-medium text-muted-foreground">Course</p>
        <p className="mt-0.5 text-xl font-semibold">{courseTitle}</p>
        {(draft.course.professor || draft.term) && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {[draft.course.professor, draft.term].filter(Boolean).join(" · ")}
          </p>
        )}
        {existing && (
          <p className="mt-2 text-sm">
            Matches your existing course <span className="font-medium">{existing.code}</span>. New items will be added to
            it.
          </p>
        )}

        <div className="mt-5 flex items-center gap-2">
          <SparklesIcon aria-hidden className="size-4 text-primary" />
          <p className="font-semibold">
            {count} academic {count === 1 ? "item" : "items"} found
          </p>
        </div>
        {count > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {[...byType].map(([type, n]) => (
              <li key={type} className="rounded-md bg-background px-2 py-0.5 ring-1 ring-border">
                {n} {typeLabel[type].toLowerCase()}
                {n === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        )}

        {(toCheck > 0 || duplicates > 0 || draft.warnings.length > 0) && (
          <ul className="mt-4 space-y-1.5 text-sm">
            {toCheck > 0 && (
              <li className="flex items-start gap-2 text-warning">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {toCheck} {toCheck === 1 ? "item needs" : "items need"} a closer look (for example, a missing year or date).
              </li>
            )}
            {duplicates > 0 && (
              <li className="flex items-start gap-2 text-muted-foreground">
                <CopyIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {duplicates} {duplicates === 1 ? "item looks" : "items look"} like tasks you already have. They start
                unselected.
              </li>
            )}
            {draft.warnings.map((warning) => (
              <li key={warning} className="flex items-start gap-2 text-muted-foreground">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {warning}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="lg" onClick={onReview}>
          Review before importing
        </Button>
        <Button size="lg" variant="outline" onClick={onStartOver}>
          Upload a different file
        </Button>
      </div>
    </section>
  )
}
