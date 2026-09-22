import type { Course, CourseColor } from "@/lib/types"

// Course colors in the order they're handed out. Checked to stay distinguishable,
// including for color-blind students; the course code is always shown next to it too.
export const courseColors: CourseColor[] = ["sky", "emerald", "violet", "orange", "rose"]

// The first color no course uses yet, or the least-used one once all are taken.
export function pickCourseColor(existing: Course[]): CourseColor {
  const uses = (color: CourseColor) => existing.filter((course) => course.color === color).length
  return [...courseColors].sort((a, b) => uses(a) - uses(b))[0]
}
