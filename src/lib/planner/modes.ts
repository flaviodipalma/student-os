import { addDays, formatDuration } from "@/lib/format"
import type { PlanningMode, Task } from "@/lib/types"
import type { PlanningStrategy } from "./types"

// Planning modes, chosen by the student (Settings, or a what-if in the
// Assistant). A mode changes priorities and pacing only: free time, commitments,
// the study window and the daily limit stay hard rules.
//
//   balanced        the normal plan
//   deadline-focus  +25 for work due in the next 3 days
//   exam-focus      +30 for exams and quizzes due in the next 10 days
//   light-day       plan about half the usual study; urgent work can still use the full limit
//   custom          only the student's own settings (nothing learned is used)

export const MODE_LABELS: Record<PlanningMode, string> = {
  balanced: "Balanced",
  "deadline-focus": "Deadline focus",
  "exam-focus": "Exam focus",
  "light-day": "Light day",
  custom: "My settings only",
}

export type Pacing = { softMinutes: number; reason: string }

export function modeStrategy(
  mode: PlanningMode | undefined,
  tasks: Task[],
  today: string,
  maxStudyMinutesPerDay: number,
  // Whose choice it is, for "Why this?": the saved mode or a request in the Assistant.
  source: "mode" | "request" = "mode"
): { boosts: NonNullable<PlanningStrategy["boosts"]>; pacing?: Pacing } {
  const boosts: NonNullable<PlanningStrategy["boosts"]> = {}
  const whose = source === "mode" ? "your planning mode" : "your choice"
  const open = tasks.filter((task) => task.status !== "completed")
  if (mode === "exam-focus") {
    for (const task of open) {
      if ((task.type === "exam" || task.type === "quiz") && task.dueDate <= addDays(today, 10)) boosts[task.id] = { points: 30, label: `Exam focus (${whose})` }
    }
  }
  if (mode === "deadline-focus") {
    for (const task of open) if (task.dueDate <= addDays(today, 3)) boosts[task.id] = { points: 25, label: `Deadline focus (${whose})` }
  }
  if (mode === "light-day") {
    const softMinutes = Math.max(30, Math.round(maxStudyMinutesPerDay / 2 / 15) * 15)
    return {
      boosts,
      pacing: {
        softMinutes,
        reason: `Light day (${whose}): about ${formatDuration(softMinutes)} of study; urgent work can still use your ${formatDuration(maxStudyMinutesPerDay)} limit`,
      },
    }
  }
  return { boosts }
}
