import type { Metadata } from "next"
import { AssistantLoader } from "@/components/assistant/assistant-loader"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/assistant")

export const metadata: Metadata = { title: section.title }

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Opened from "Ask Student OS" with ?task=<id> or ?date=<YYYY-MM-DD>. Anything
// else is ignored; the server checks the task is the student's own on every message.
export default async function AssistantPage({ searchParams }: PageProps<"/assistant">) {
  const { task, date } = await searchParams
  return (
    <AssistantLoader
      context={{
        ...(typeof task === "string" && ID.test(task) ? { taskId: task } : {}),
        ...(typeof date === "string" && DATE.test(date) ? { date } : {}),
      }}
    />
  )
}
