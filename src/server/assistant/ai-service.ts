import type { ChatTurn } from "@/lib/assistant"

// The contract every Assistant AI provider implements (Claude today; a mock for
// local testing). The Assistant service only knows this interface, so the
// provider can change without touching the tools or the UI. Like the syllabus
// importer's SyllabusAIService, it's chosen by server environment variables and
// its credentials never leave the server.

export type AssistantToolSpec = {
  name: string
  description: string
  // JSON Schema of the tool's input.
  inputSchema: Record<string, unknown>
}

// A tool's answer, as JSON text. isError = the call failed (bad arguments, a tool error).
export type ToolCallResult = { content: string; isError: boolean }

export type AssistantAIRequest = {
  system: string
  // Changes every turn (today's date, the time, what the student is looking at).
  context: string
  messages: ChatTurn[]
  tools: AssistantToolSpec[]
  // Runs one tool for the signed-in student. Never throws.
  callTool: (name: string, input: unknown) => Promise<ToolCallResult>
}

export interface StudentAssistantAIService {
  // Returns the Assistant's reply text. Throws AssistantAIError on failure.
  respond(request: AssistantAIRequest): Promise<string>
}

// Why a request failed (for the server log). The student always sees the same
// friendly message (ASSISTANT_ERROR_MESSAGE).
export type AssistantAIErrorKind = "not-configured" | "unavailable" | "timeout" | "busy" | "refused" | "too-many-steps" | "failed"

export class AssistantAIError extends Error {
  constructor(
    readonly kind: AssistantAIErrorKind,
    options?: { cause?: unknown }
  ) {
    super(`Assistant AI request failed: ${kind}`, options)
    this.name = "AssistantAIError"
  }
}
