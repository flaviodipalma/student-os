import type { Metadata } from "next"
import { CourseDetail } from "@/components/courses/course-detail"

// The page title is set by CourseDetail once it has found the course.
export const metadata: Metadata = { title: "Course" }

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params
  return <CourseDetail courseId={courseId} />
}
