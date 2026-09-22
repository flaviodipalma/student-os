import type { Metadata } from "next"
import { ComingSoon } from "@/components/coming-soon"
import { PageHeader } from "@/components/app-shell/page-header"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/courses")

export const metadata: Metadata = { title: section.title }

export default function CoursesPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <ComingSoon
        icon={section.icon}
        title={section.title}
        planned={[
          "Keep a list of your classes for the term",
          "Import a syllabus to pull out every deadline",
        ]}
      />
    </>
  )
}
