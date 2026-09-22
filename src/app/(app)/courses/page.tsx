import type { Metadata } from "next"
import Link from "next/link"
import { FileUpIcon } from "lucide-react"
import { PageHeader } from "@/components/app-shell/page-header"
import { CourseGrid } from "@/components/courses/course-grid"
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
          <Link href="/courses/import" className={buttonVariants({ size: "lg" })}>
            <FileUpIcon data-icon="inline-start" />
            Import syllabus
          </Link>
        }
      />
      <CourseGrid />
    </>
  )
}
