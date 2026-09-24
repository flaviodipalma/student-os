import { z } from "zod"
import type { PendingAction } from "@/lib/assistant"
import { dateKeySchema } from "@/lib/validation"
import type { ToolContext } from "./context"

// One tool the model can call. The input is checked against `input` before
// `run` sees it; `run` returns structured data (turned into JSON for the model).
// Action tools also return a PendingAction: a proposal the student confirms.

export type ToolOutput = {
  result: unknown
  pending?: PendingAction
  // The task this result is about (for "that task" in the next message).
  focusTaskId?: string
}

export type AssistantTool = {
  name: string
  description: string
  input: z.ZodType
  run: (ctx: ToolContext, input: unknown) => ToolOutput
}

export function defineTool<S extends z.ZodType>(tool: {
  name: string
  description: string
  input: S
  run: (ctx: ToolContext, input: z.infer<S>) => ToolOutput
}): AssistantTool {
  return tool as AssistantTool
}

export const dateInput = dateKeySchema.describe("A date as YYYY-MM-DD.")
export const timeInput = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time like 17:00.")
  .describe("A 24-hour time as HH:MM, e.g. 17:00 for 5 PM.")
export const taskRefInput = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .describe("The task's taskId (preferred, from an earlier result) or words from its title.")
