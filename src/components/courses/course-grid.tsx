"use client"

import Link from "next/link"
import { FileUpIcon } from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { useCourses } from "@/lib/course-store"
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
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  )
}
