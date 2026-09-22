"use client"

import Link from "next/link"
import { FileUpIcon, GraduationCapIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { useCourses } from "@/lib/course-store"

// Shown on the Dashboard until the student has added a course.
export function GettingStarted() {
  const { courses } = useCourses()
  if (courses.length > 0) return null

  return (
    <section className="flex flex-col gap-4 rounded-xl bg-primary/[0.05] p-6 ring-1 ring-primary/15 sm:flex-row sm:items-center">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCapIcon className="size-5" />
      </span>
      <div className="flex-1">
        <h2 className="font-semibold">Welcome to Student OS</h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Start by adding your courses. Importing a syllabus adds its deadlines too.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Link href="/courses/import" className={buttonVariants()}>
          <FileUpIcon data-icon="inline-start" />
          Import a syllabus
        </Link>
        <Link href="/courses" className={buttonVariants({ variant: "outline" })}>
          Add a course
        </Link>
      </div>
    </section>
  )
}
