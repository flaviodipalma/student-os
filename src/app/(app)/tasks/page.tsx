import type { Metadata } from "next"
import { ComingSoon } from "@/components/coming-soon"
import { PageHeader } from "@/components/app-shell/page-header"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/tasks")

export const metadata: Metadata = { title: section.title }

export default function TasksPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <ComingSoon
        icon={section.icon}
        title={section.title}
        planned={[
          "Add assignments, readings and exams with due dates",
          "Estimate how long each one will take",
          "Mark things done as you go",
        ]}
      />
    </>
  )
}
