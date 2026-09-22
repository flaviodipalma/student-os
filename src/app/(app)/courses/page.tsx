import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { CourseCard } from "@/components/courses/course-card"
import { courses } from "@/lib/data/courses"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/courses")

export const metadata: Metadata = { title: section.title }

export default function CoursesPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <div className="grid gap-4 md:grid-cols-2">
        {courses.map((course) => (
          <CourseCard key={course.id} course={course} />
        ))}
      </div>
    </>
  )
}
