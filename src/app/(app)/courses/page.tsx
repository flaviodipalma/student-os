import type { Metadata } from "next"
import Link from "next/link"
import { FileUpIcon } from "lucide-react"
import { PageHeader } from "@/components/app-shell/page-header"
import { ClassTimesNotice } from "@/components/courses/class-times"
import { CourseGrid } from "@/components/courses/course-grid"
import { NewCourseButton } from "@/components/courses/new-course-button"
import { buttonVariants } from "@/components/ui/button"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/courses")

export const metadata: Metadata = { title: section.title }

export default function CoursesPage() {
  return (
    <>
      <PageHeader
        title={section.title}
        description={section.description}
        action={
          <div className="flex flex-wrap gap-2">
            <NewCourseButton />
            <Link href="/courses/import" className={buttonVariants({ size: "lg" })}>
              <FileUpIcon data-icon="inline-start" />
              Import syllabus
            </Link>
          </div>
        }
      />
      <div className="space-y-4">
        <ClassTimesNotice />
        <CourseGrid />
      </div>
    </>
  )
}
