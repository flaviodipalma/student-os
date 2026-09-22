"use client"

import { createContext, use, useState } from "react"
import { pickCourseColor } from "@/lib/data/courses"
import type { Course, CourseInput } from "@/lib/types"

// The single source of courses for the whole app, like the task and event stores.
// In memory for now: changes survive moving between pages but reset on reload.

type CourseStore = {
  courses: Course[]
  getCourse: (id: string) => Course | undefined
  // Adds a course and returns it (with its new id and color).
  addCourse: (input: CourseInput) => Course
  updateCourse: (id: string, changes: Partial<CourseInput>) => void
}

const CourseStoreContext = createContext<CourseStore | null>(null)

export function CourseStoreProvider({
  initialCourses,
  children,
}: {
  initialCourses: Course[]
  children: React.ReactNode
}) {
  const [courses, setCourses] = useState(initialCourses)

  const store: CourseStore = {
    courses,
    getCourse: (id) => courses.find((course) => course.id === id),
    addCourse: (input) => {
      const course: Course = { ...input, id: crypto.randomUUID(), color: pickCourseColor(courses) }
      setCourses((prev) => [...prev, course])
      return course
    },
    updateCourse: (id, changes) =>
      setCourses((prev) => prev.map((course) => (course.id === id ? { ...course, ...changes } : course))),
  }

  return <CourseStoreContext value={store}>{children}</CourseStoreContext>
}

export function useCourses(): CourseStore {
  const store = use(CourseStoreContext)
  if (!store) throw new Error("useCourses must be used inside CourseStoreProvider")
  return store
}
