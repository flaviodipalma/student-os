"use client"

import { useAppStore } from "@/lib/app-store"
import { classTimesOf } from "@/lib/class-times"

// Courses from the shared app store (loaded from the database).
export function useCourses() {
  const { courses, getCourse, addCourse, updateCourse, deleteCourse, bulkUpdateCourses } = useAppStore()
  return { courses, getCourse, addCourse, updateCourse, deleteCourse, bulkUpdateCourses }
}

// A course's class times (its "class" recurring commitments) and how to change them.
export function useClassTimes() {
  const { recurringCommitments, setClassTimes } = useAppStore()
  return {
    classTimesOf: (courseId: string) => classTimesOf(recurringCommitments, courseId),
    setClassTimes,
  }
}
