import { cn } from "@/lib/utils"
import type { CourseColor } from "@/lib/types"

// Tailwind needs full class names written out, so colors map to classes here
// (theme tokens: --course-<color> in globals.css).
export const courseColorClass: Record<CourseColor, string> = {
  sky: "bg-course-sky",
  emerald: "bg-course-emerald",
  violet: "bg-course-violet",
  orange: "bg-course-orange",
  rose: "bg-course-rose",
}

export function CourseTag({
  code,
  color,
  className,
}: {
  code: string
  color: CourseColor
  className?: string
}) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-medium", className)}>
      <span aria-hidden className={cn("size-2 rounded-full", courseColorClass[color])} />
      {code}
    </span>
  )
}
