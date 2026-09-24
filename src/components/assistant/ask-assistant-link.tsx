import Link from "next/link"
import { MessageSquareTextIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// "Ask Student OS": opens the Assistant about a task or a Planner day. Only the
// id / date go in the link; the server looks them up for the signed-in student.
export function AskAssistantLink({
  taskId,
  date,
  className,
  children = "Ask Student OS",
}: {
  taskId?: string
  date?: string
  className?: string
  children?: React.ReactNode
}) {
  const params = new URLSearchParams()
  if (taskId) params.set("task", taskId)
  if (date) params.set("date", date)
  const query = params.toString()
  return (
    <Link
      href={query ? `/assistant?${query}` : "/assistant"}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50",
        className
      )}
    >
      <MessageSquareTextIcon aria-hidden className="size-4" />
      {children}
    </Link>
  )
}
