"use client"

import { useState } from "react"
import Link from "next/link"
import { FileUpIcon, ListChecksIcon } from "lucide-react"
import { Button, buttonVariants } from "@/components/ui/button"
import { useCourses } from "@/lib/course-store"
import type { Course } from "@/lib/types"
import { BulkCourseBar } from "./bulk-course-bar"
import { CourseCard } from "./course-card"
import { NewCourseButton } from "./new-course-button"

export function CourseGrid() {
  const { courses } = useCourses()
  if (courses.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-12 text-center">
        <p className="font-medium">No courses yet.</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Add one, or import a syllabus to add a course and its deadlines at once.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          <NewCourseButton />
          <Link href="/courses/import" className={buttonVariants({ size: "lg" })}>
            <FileUpIcon data-icon="inline-start" />
            Import syllabus
          </Link>
        </div>
      </div>
    )
  }
  return <SelectableCourses courses={courses} />
}

// The course cards, with a select mode: pick courses (or all), then delete or
// change them together from the bar at the bottom.
function SelectableCourses({ courses }: { courses: Course[] }) {
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  // Only courses that still exist (one may have been deleted meanwhile).
  const selected = courses.filter((course) => picked.has(course.id))
  const allSelected = selected.length === courses.length

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const stop = () => {
    setSelecting(false)
    setPicked(new Set())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {selecting ? (
          <>
            <Button variant="ghost" onClick={() => setPicked(allSelected ? new Set() : new Set(courses.map((course) => course.id)))}>
              {allSelected ? "Clear selection" : "Select all"}
            </Button>
            <Button variant="outline" onClick={stop}>
              Done
            </Button>
          </>
        ) : (
          <Button variant="outline" onClick={() => setSelecting(true)}>
            <ListChecksIcon data-icon="inline-start" />
            Select
          </Button>
        )}
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {courses.map((course) => (
          <CourseCard
            key={course.id}
            course={course}
            selecting={selecting}
            selected={picked.has(course.id)}
            onToggle={() => toggle(course.id)}
          />
        ))}
      </div>
      {selecting && <BulkCourseBar selected={selected} onDeleted={stop} />}
    </div>
  )
}
