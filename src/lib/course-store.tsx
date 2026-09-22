"use client"

import { useAppStore } from "@/lib/app-store"

// Courses from the shared app store (loaded from the database).
export function useCourses() {
  const { courses, getCourse, addCourse, updateCourse, deleteCourse } = useAppStore()
  return { courses, getCourse, addCourse, updateCourse, deleteCourse }
}
