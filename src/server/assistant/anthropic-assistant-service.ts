import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { modelSettings } from "@/lib/ai/model-settings"
import { AssistantAIError, type AssistantAIRequest, type StudentAssistantAIService } from "./ai-service"

// Claude implementation of StudentAssistantAIService: a tool-use loop. Claude
// asks for tools, the Assistant service runs them for the signed-in student,
// and the results go back until Claude answers. The API key is read from
// ANTHROPIC_API_KEY on the server and never reaches the browser.

const DEFAULT_MODEL = "claude-opus-5"
// Tool rounds per message. A normal question needs 1-3.
const MAX_STEPS = 6

export class AnthropicAssistantService implements StudentAssistantAIService {
  private readonly client: Anthropic
  private readonly model: string

  constructor(options: { model?: string; client?: Anthropic } = {}) {
    // Chat has to feel quick: 45s per attempt, one retry.
    this.client = options.client ?? new Anthropic({ timeout: 45_000, maxRetries: 1 })
    this.model = options.model ?? process.env.ASSISTANT_AI_MODEL ?? process.env.SYLLABUS_AI_MODEL ?? DEFAULT_MODEL
  }

  async respond(request: AssistantAIRequest): Promise<string> {
    const { thinking } = modelSettings(this.model)
    const tools: Anthropic.Tool[] = request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    }))
    const messages: Anthropic.MessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }))

    for (let step = 0; step < MAX_STEPS; step++) {
      let response: Anthropic.Message
      try {
        response = await this.client.messages.create({
          model: this.model,
          max_tokens: 8000,
          thinking,
          // The rules and tools don't change between requests, so they're cached;
          // the per-turn context comes after the cache breakpoint.
          system: [
            { type: "text", text: request.system, cache_control: { type: "ephemeral" } },
            { type: "text", text: request.context },
          ],
          tools,
          messages,
        })
      } catch (error) {
        throw toAssistantError(error)
      }

      if (response.stop_reason === "refusal") {
        console.warn("[assistant-ai] request declined")
        throw new AssistantAIError("refused")
      }
      if (response.stop_reason !== "tool_use") {
        const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n").trim()
        if (!text) throw new AssistantAIError("failed")
        return text
      }

      // Run every tool Claude asked for, then send the results back.
      messages.push({ role: "assistant", content: response.content })
      const results: Anthropic.ToolResultBlockParam[] = []
      for (const block of response.content) {
        if (block.type !== "tool_use") continue
        const result = await request.callTool(block.name, block.input)
        results.push({ type: "tool_result", tool_use_id: block.id, content: result.content, is_error: result.isError })
      }
      messages.push({ role: "user", content: results })
    }
    throw new AssistantAIError("too-many-steps")
  }
}

// Status and error type go to the server log, never the student's messages or data.
function toAssistantError(error: unknown): AssistantAIError {
  if (error instanceof AssistantAIError) return error
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new AssistantAIError("timeout", { cause: error })
  if (error instanceof Anthropic.APIConnectionError) return new AssistantAIError("unavailable", { cause: error })
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error("[assistant-ai] authentication failed: check ANTHROPIC_API_KEY", { status: error.status })
    return new AssistantAIError("not-configured", { cause: error })
  }
  if (error instanceof Anthropic.RateLimitError) return new AssistantAIError("busy", { cause: error })
  if (error instanceof Anthropic.APIError) {
    console.error("[assistant-ai] API error", { status: error.status, type: error.name })
    return new AssistantAIError(error.status === 529 ? "busy" : "failed", { cause: error })
  }
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
  console.error(hasKey ? "[assistant-ai] request failed before reaching the API" : "[assistant-ai] no credentials: set ANTHROPIC_API_KEY")
  return new AssistantAIError(hasKey ? "failed" : "not-configured", { cause: error })
}
