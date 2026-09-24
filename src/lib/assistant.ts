import type { Priority, StudySessionRecord, Task, TaskType } from "@/lib/types"

// Shapes shared by the Assistant page (browser) and the Assistant service (server).
// See src/server/assistant/README.md for how the pieces fit together.

// One message in the conversation, as the browser keeps it. Only the text is
// sent back each turn (no tool calls), so the history stays small.
export type ChatTurn = { role: "user" | "assistant"; content: string }

// Where the Assistant was opened from ("Ask Student OS" on the Dashboard or
// Planner): ids and a date only. The server looks them up for the signed-in
// student and ignores anything that isn't theirs.
export type AssistantPageContext = { taskId?: string; date?: string }

// A change the Assistant wants to make. Nothing is saved until the student
// presses Confirm; the server then checks it again against fresh data.
export type ProposedAction =
  | { kind: "complete-task"; taskId: string }
  | {
      kind: "create-task"
      task: {
        courseId: string
        title: string
        type: TaskType
        dueDate: string
        dueTime?: string
        priority: Priority
        estimateMinutes: number | null
      }
    }
  | {
      kind: "update-task"
      taskId: string
      changes: {
        title?: string
        dueDate?: string
        dueTime?: string | null
        priority?: Priority
        estimateMinutes?: number | null
        status?: "not_started" | "in_progress"
      }
    }
  // sessionId: a stored session to move; without one, a new session is put on the calendar.
  | { kind: "schedule-session"; taskId: string; sessionId?: string; date: string; startTime: string; endTime: string }
  // Work the student already did ("I worked 45 minutes on it"): saved as a
  // completed study session, so the Planner only plans what's left.
  | { kind: "log-progress"; taskId: string; date: string; startTime: string; endTime: string }
  // A plan the student agreed to ("OK, put that on my calendar"): the Planner's
  // sessions for one day, each checked again against free time on Confirm.
  | { kind: "accept-sessions"; date: string; sessions: PlannedBlock[] }
  // "I can't study today": the day's planned work moves to other days (saved as
  // skipped sessions, the same as Skip on the Planner page).
  | { kind: "skip-day"; date: string; sessions: PlannedBlock[] }

export type PlannedBlock = { taskId: string; startTime: string; endTime: string }

export type PendingAction = {
  action: ProposedAction
  // Written by the server from the checked data (never by the model), e.g.
  // "Move the deadline of “Database Project” from Fri, Sep 25 to Sat, Sep 26."
  summary: string
  // Anything the student should know first (e.g. "This goes over your daily study limit.").
  note?: string
  confirmLabel: string
}

export type AssistantReply = {
  message: string
  pending?: PendingAction
  // The task this turn was about, so "that task" / "it" work in the next message.
  focusTaskId?: string
}

// What Confirm returns: a message for the conversation and the saved records,
// so every page shows the change straight away.
export type ConfirmedChange = {
  message: string
  tasks: Task[]
  studySessions: StudySessionRecord[]
}

// Shown for any failure the student can't act on (provider down, timeout, ...).
export const ASSISTANT_ERROR_MESSAGE = "I couldn't process that right now. Please try again."

// Limits on what the browser can send.
export const MAX_MESSAGE_LENGTH = 2000
export const MAX_HISTORY = 12
