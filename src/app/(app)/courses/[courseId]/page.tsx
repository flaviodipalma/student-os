import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { CourseDetail } from "@/components/courses/course-detail"
import { getCourse } from "@/lib/data/courses"

export async function generateMetadata({
  params,
}: PageProps<"/courses/[courseId]">): Promise<Metadata> {
  const { courseId } = await params
  const course = getCourse(courseId)
  return { title: course ? `${course.code} ${course.name}` : "Course not found" }
}

export default async function CoursePage({ params }: PageProps<"/courses/[courseId]">) {
  const { courseId } = await params
  const course = getCourse(courseId)
  if (!course) notFound()

  return <CourseDetail course={course} />
}
