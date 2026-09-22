"use client"

import { useCourses } from "@/lib/course-store"
import { CourseCard } from "./course-card"

export function CourseGrid() {
  const { courses } = useCourses()
  if (courses.length === 0) {
    return (
      <p className="rounded-xl border border-dashed px-6 py-12 text-center text-sm text-muted-foreground">
        No courses yet. Add one, or import a syllabus to add a course and its deadlines at once.
      </p>
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
