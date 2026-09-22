"use client"

import { useCourses } from "@/lib/course-store"
import { CourseCard } from "./course-card"

export function CourseGrid() {
  const { courses } = useCourses()
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {courses.map((course) => (
        <CourseCard key={course.id} course={course} />
      ))}
    </div>
  )
}
