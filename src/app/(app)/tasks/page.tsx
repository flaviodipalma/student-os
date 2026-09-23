import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { NewTaskButton } from "@/components/tasks/new-task-button"
import { TasksView } from "@/components/tasks/tasks-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/tasks")

export const metadata: Metadata = { title: section.title }

// ?task=<id> opens that task (links from reminders). Only the student's own tasks
// are in the store, so another student's id simply opens nothing.
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const task = (await searchParams).task
  const focusTaskId = typeof task === "string" ? task : undefined
  return (
    <>
      <PageHeader title={section.title} description={section.description} action={<NewTaskButton />} />
      <TasksView key={focusTaskId} focusTaskId={focusTaskId} />
    </>
  )
}
