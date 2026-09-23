"use client"

import Link from "next/link"
import { CircleCheckIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { useCourses } from "@/lib/course-store"
import type { ImportResult } from "@/lib/syllabus/import"

export function DonePanel({
  result,
  onImportAnother,
  onFinished,
}: {
  result: ImportResult
  onImportAnother: () => void
  // Set during onboarding: continue setup instead of opening the course.
  onFinished?: () => void
}) {
  const course = useCourses().getCourse(result.courseId)
  const name = course ? `${course.code} — ${course.name}` : "your course"

  return (
    <section className="rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
      <CircleCheckIcon aria-hidden className="mx-auto size-10 text-emerald-600" />
      <h1 className="mt-4 text-xl font-semibold">Imported into Student OS</h1>
      <p className="mt-1 text-muted-foreground">
        {result.createdCourse ? "Created " : "Updated "}
        <span className="font-medium text-foreground">{name}</span>
        {` with ${result.taskCount} ${result.taskCount === 1 ? "task" : "tasks"}. They're now in your Tasks, Dashboard and Planner.`}
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {onFinished ? (
          <>
            <Button size="lg" onClick={onFinished}>
              Continue setup
            </Button>
            <Button size="lg" variant="outline" onClick={onImportAnother}>
              Import another syllabus
            </Button>
          </>
        ) : (
          <>
            <Link href={`/courses/${result.courseId}`} className={buttonVariants({ size: "lg" })}>
              View course
            </Link>
            <Link href="/planner" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Open Planner
            </Link>
            <Button size="lg" variant="ghost" onClick={onImportAnother}>
              Import another syllabus
            </Button>
          </>
        )}
      </div>
    </section>
  )
}
