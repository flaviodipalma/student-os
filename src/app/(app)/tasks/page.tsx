import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { NewTaskButton } from "@/components/tasks/new-task-button"
import { TasksView } from "@/components/tasks/tasks-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/tasks")

export const metadata: Metadata = { title: section.title }

export default function TasksPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} action={<NewTaskButton />} />
      <TasksView />
    </>
  )
}
