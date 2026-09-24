import "server-only"

import { z } from "zod"
import type { AssistantPageContext, AssistantReply, ChatTurn, ConfirmedChange, PendingAction, ProposedAction } from "@/lib/assistant"
import { ASSISTANT_ERROR_MESSAGE } from "@/lib/assistant"
import { toMinutes } from "@/lib/events"
import { formatDuration } from "@/lib/format"
import { dateKeySchema, firstIssue, idSchema } from "@/lib/validation"
import type { Database } from "../db/types"
import { AppError, ValidationError } from "../errors"
import { loadAppData } from "../services/app-data"
import { createStudySession, updateStudySession } from "../services/study-sessions"
import { createTask, updateTask } from "../services/tasks"
import { actionTools, dueText, MAX_BLOCKS, prepareAction } from "./action-tools"
import { AssistantAIError, type AssistantToolSpec, type StudentAssistantAIService, type ToolCallResult } from "./ai-service"
import { createToolContext, timeLabel, untrusted, type ToolContext } from "./context"
import { ASSISTANT_SYSTEM_PROMPT, turnContext } from "./prompt"
import { planningActionTools, planningTools } from "./planning-tools"
import { readTools } from "./read-tools"
import type { AssistantTool } from "./tool"
import { logger } from "@/server/log"

// The Assistant service: one student's message in, a reply (and maybe a change
// to confirm) out.
//
//   Assistant page -> askAssistantAction (who is signed in, input checks)
//     -> askAssistant: the student's data + the Planner -> tools
//     -> the AI provider (Claude) calls tools -> reply
//   Confirm -> confirmAssistantAction -> confirmAssistantChange: checks the
//     change again, then saves it with the normal task / study session services.
//
// The model never sees the database, a user id or a way to save anything:
// tools read from data already loaded for the signed-in student, and changes
// only happen when the student presses Confirm.

export const assistantTools: AssistantTool[] = [...readTools, ...planningTools, ...actionTools]
const toolsByName = new Map(assistantTools.map((tool) => [tool.name, tool]))
// Tools that propose a change (one per reply).
const actionNames = new Set([...actionTools, ...planningActionTools].map((tool) => tool.name))

function jsonSchemaOf(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>
  delete json.$schema
  return json
}

export const assistantToolSpecs: AssistantToolSpec[] = assistantTools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  inputSchema: jsonSchemaOf(tool.input),
}))

// What tools produced during one reply.
export type TurnState = { pending?: PendingAction; focusTaskId?: string }

const asJson = (value: unknown, isError = false): ToolCallResult => ({ content: JSON.stringify(value), isError })

// Runs one tool call from the model. Never throws: a bad call becomes an error
// result the model can recover from.
export function runTool(ctx: ToolContext, state: TurnState, name: string, input: unknown): ToolCallResult {
  const tool = toolsByName.get(name)
  if (!tool) return asJson({ error: "unknown_tool", problem: `There's no tool called ${untrusted(name, 60)}.` }, true)
  const parsed = tool.input.safeParse(input ?? {})
  if (!parsed.success) return asJson({ error: "invalid_arguments", problem: firstIssue(parsed.error) }, true)
  if (actionNames.has(name) && state.pending) {
    return asJson({ status: "rejected", problem: "Only one change can be proposed per reply. Ask the student to confirm or cancel the first one." })
  }
  try {
    const output = tool.run(ctx, parsed.data)
    if (output.pending) state.pending = output.pending
    if (output.focusTaskId) state.focusTaskId = output.focusTaskId
    return asJson(output.result)
  } catch (error) {
    logger.error("assistant", "tool failed", { tool: name, type: error instanceof Error ? error.name : typeof error })
    return asJson({ error: "tool_failed", problem: "That lookup failed. Tell the student you couldn't get that information right now." }, true)
  }
}

// ---- Input from the browser (checked in the server action).

export const askAssistantSchema = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(4000) }))
    .min(1)
    .max(30)
    .refine((messages) => messages.at(-1)?.role === "user", "The last message must be the student's.")
    .refine((messages) => (messages.at(-1)?.content.length ?? 0) <= 2000, "That message is too long. Keep it under 2,000 characters."),
  context: z.object({ taskId: idSchema.optional(), date: dateKeySchema.optional() }).default({}),
  focusTaskId: idSchema.optional(),
})
export type AskAssistantInput = z.infer<typeof askAssistantSchema>

export type AssistantDeps = {
  db: Database
  // Always from the verified session, never from the request.
  userId: string
  // The student's wall-clock time (see src/server/student-clock.ts) and zone.
  now: Date
  timeZone: string | undefined
}

// The model gets the last few messages only, starting with one of the student's.
function recentMessages(messages: ChatTurn[]): ChatTurn[] {
  const recent = messages.slice(-12)
  const first = recent.findIndex((m) => m.role === "user")
  return recent.slice(first)
}

export async function askAssistant(
  deps: AssistantDeps & { ai: StudentAssistantAIService },
  input: AskAssistantInput
): Promise<AssistantReply> {
  const data = await loadAppData(deps.db, deps.userId)
  const ctx = createToolContext(data, deps.now, deps.timeZone)
  // Ids from the browser only count if they're this student's.
  const ownTask = (id: string | undefined) => (id && data.tasks.some((task) => task.id === id) ? id : undefined)
  const focusTaskId = ownTask(input.focusTaskId) ?? ownTask(input.context.taskId)
  const page: AssistantPageContext = { taskId: focusTaskId, date: input.context.date }

  const state: TurnState = {}
  let message: string
  try {
    message = await deps.ai.respond({
      system: ASSISTANT_SYSTEM_PROMPT,
      context: turnContext(ctx, page),
      messages: recentMessages(input.messages),
      tools: assistantToolSpecs,
      callTool: async (name, toolInput) => runTool(ctx, state, name, toolInput),
    })
  } catch (error) {
    const kind = error instanceof AssistantAIError ? error.kind : "failed"
    if (!(error instanceof AssistantAIError)) logger.error("assistant", "unexpected error", { type: error instanceof Error ? error.name : typeof error })
    logger.warn("assistant", "request failed", { kind })
    throw new AppError("unavailable", ASSISTANT_ERROR_MESSAGE)
  }
  return { message, ...(state.pending ? { pending: state.pending } : {}), ...(state.focusTaskId ?? focusTaskId ? { focusTaskId: state.focusTaskId ?? focusTaskId } : {}) }
}

// ---- Confirm

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time.")
const priority = z.enum(["low", "medium", "high", "critical"])
const plannedBlock = z.object({ taskId: idSchema, startTime: time, endTime: time })

export const proposedActionSchema: z.ZodType<ProposedAction> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("complete-task"), taskId: idSchema }),
  z.object({
    kind: z.literal("create-task"),
    task: z.object({
      courseId: idSchema,
      title: z.string().trim().min(1).max(200),
      type: z.enum(["assignment", "exam", "quiz", "project", "paper", "reading", "lab", "presentation", "study", "other"]),
      dueDate: dateKeySchema,
      dueTime: time.optional(),
      priority,
      estimateMinutes: z.int().min(1).max(10000).nullable(),
    }),
  }),
  z.object({
    kind: z.literal("update-task"),
    taskId: idSchema,
    changes: z.object({
      title: z.string().trim().min(1).max(200).optional(),
      dueDate: dateKeySchema.optional(),
      dueTime: time.nullable().optional(),
      priority: priority.optional(),
      estimateMinutes: z.int().min(1).max(10000).nullable().optional(),
      status: z.enum(["not_started", "in_progress"]).optional(),
    }),
  }),
  z.object({
    kind: z.literal("log-progress"),
    taskId: idSchema,
    date: dateKeySchema,
    startTime: time,
    endTime: time,
  }),
  z.object({
    kind: z.literal("schedule-session"),
    taskId: idSchema,
    sessionId: idSchema.optional(),
    date: dateKeySchema,
    startTime: time,
    endTime: time,
  }),
  z.object({ kind: z.literal("accept-sessions"), date: dateKeySchema, sessions: z.array(plannedBlock).min(1).max(MAX_BLOCKS) }),
  z.object({ kind: z.literal("skip-day"), date: dateKeySchema, sessions: z.array(plannedBlock).min(1).max(MAX_BLOCKS) }),
])

// Saves a change the student confirmed. The proposal came back from the browser,
// so it's checked again from scratch against this student's current data (the
// same checks as when it was proposed, including free time for sessions).
export async function confirmAssistantChange(deps: AssistantDeps, action: ProposedAction): Promise<ConfirmedChange> {
  const data = await loadAppData(deps.db, deps.userId)
  const ctx = createToolContext(data, deps.now, deps.timeZone)
  const check = prepareAction(ctx, action)
  if (!check.ok) throw new ValidationError(check.problem)
  const { db, userId } = deps
  const quote = (title: string | undefined) => `“${untrusted(title)}”`

  switch (action.kind) {
    case "complete-task": {
      const task = await updateTask(db, userId, action.taskId, { status: "completed" })
      return { message: `Done. ${quote(task.title)} is marked complete.`, tasks: [task], studySessions: [] }
    }
    case "create-task": {
      const task = await createTask(db, userId, { ...action.task, id: crypto.randomUUID(), description: "", status: "not_started" })
      return { message: `Done. ${quote(task.title)} is added, due ${dueText(ctx, task.dueDate, task.dueTime)}.`, tasks: [task], studySessions: [] }
    }
    case "update-task": {
      const task = await updateTask(db, userId, action.taskId, action.changes)
      return { message: `Done. ${quote(task.title)} is updated.`, tasks: [task], studySessions: [] }
    }
    case "log-progress": {
      const session = await createStudySession(db, userId, {
        id: crypto.randomUUID(),
        taskId: action.taskId,
        date: action.date,
        startTime: action.startTime,
        endTime: action.endTime,
        status: "completed",
      })
      return {
        message: `Done. ${formatDuration(toMinutes(action.endTime) - toMinutes(action.startTime))} of work on ${quote(data.tasks.find((task) => task.id === action.taskId)?.title)} is recorded; your plan now counts it.`,
        tasks: [],
        studySessions: [session],
      }
    }
    case "accept-sessions":
    case "skip-day": {
      const status = action.kind === "accept-sessions" ? "scheduled" : "skipped"
      // All or nothing.
      const sessions = await db.transaction(async (tx) =>
        Promise.all(action.sessions.map((block) => createStudySession(tx, userId, { id: crypto.randomUUID(), date: action.date, ...block, status })))
      )
      const day = dueText(ctx, action.date)
      return {
        message:
          action.kind === "accept-sessions"
            ? `Done. ${sessions.length === 1 ? "1 study session is" : `${sessions.length} study sessions are`} on your calendar for ${day}.`
            : `Done. No study planned for ${day}; that work moves to your other days.`,
        tasks: [],
        studySessions: sessions,
      }
    }
    case "schedule-session": {
      const times = { date: action.date, startTime: action.startTime, endTime: action.endTime }
      const session = action.sessionId
        ? await updateStudySession(db, userId, action.sessionId, { ...times, status: "scheduled", completedMinutes: null })
        : await createStudySession(db, userId, { id: crypto.randomUUID(), taskId: action.taskId, ...times, status: "scheduled" })
      return {
        message: `Done. Your ${quote(data.tasks.find((task) => task.id === action.taskId)?.title)} study session is now scheduled for ${dueText(ctx, session.date)} at ${timeLabel(session.startTime)}.`,
        tasks: [],
        studySessions: [session],
      }
    }
  }
}
