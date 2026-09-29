import type { AcademicEventKind } from "@/lib/types"

// Academic calendar items: a small colored label per kind (always with words, not
// only color). Used by Calendar > Academic calendar and the calendar's all-day row.
export const academicKindStyle: Record<AcademicEventKind, string> = {
  term: "bg-primary/10 text-primary",
  no_classes: "bg-success-soft text-success",
  exams: "bg-danger-soft text-danger",
  deadline: "bg-warning-soft text-warning",
  other: "bg-muted text-muted-foreground",
}
