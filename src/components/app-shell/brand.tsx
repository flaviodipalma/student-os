import Link from "next/link"
import { GraduationCapIcon } from "lucide-react"

export function Brand() {
  return (
    <Link
      href="/dashboard"
      className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <GraduationCapIcon className="size-4.5" />
      </span>
      <span className="text-base font-semibold tracking-tight">Student OS</span>
    </Link>
  )
}
