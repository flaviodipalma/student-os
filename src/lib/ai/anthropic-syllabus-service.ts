import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { SyllabusImportError } from "@/lib/syllabus/errors"
import { syllabusExtractionSchema } from "@/lib/syllabus/schema"
import { modelSettings } from "./model-settings"
import { SYLLABUS_EXTRACTION_SYSTEM_PROMPT } from "./prompts/syllabus-extraction"
import type { SyllabusAIContext, SyllabusAIService } from "./syllabus-ai-service"

// Claude implementation of SyllabusAIService. Server-only: the API key is read
// from the ANTHROPIC_API_KEY environment variable and never reaches the browser.

const DEFAULT_MODEL = "claude-opus-5"

export class AnthropicSyllabusService implements SyllabusAIService {
  private readonly client: Anthropic
  private readonly model: string

  constructor(options: { model?: string } = {}) {
    // 90s per attempt; the SDK retries rate limits, 5xx errors and dropped connections twice.
    this.client = new Anthropic({ timeout: 90_000, maxRetries: 2 })
    this.model = options.model ?? process.env.SYLLABUS_AI_MODEL ?? DEFAULT_MODEL
  }

  async extractSyllabusData(text: string, context: SyllabusAIContext): Promise<unknown> {
    const settings = modelSettings(this.model)
    let response
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: settings.thinking,
        system: [
          { type: "text", text: SYLLABUS_EXTRACTION_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages: [
          {
            role: "user",
            content: `Today's date is ${context.today}.\n\n<syllabus>\n${text}\n</syllabus>`,
          },
        ],
        // Structured output: the answer must match the syllabus schema.
        output_config: { format: betaZodOutputFormat(syllabusExtractionSchema) },
        ...(settings.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      })
    } catch (error) {
      throw toSyllabusError(error)
    }

    if (response.stop_reason === "refusal") {
      console.warn("[syllabus-ai] request declined", { category: response.stop_details?.category ?? null })
      throw new SyllabusImportError("ai-failed")
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      console.warn("[syllabus-ai] incomplete structured output", { stopReason: response.stop_reason })
      throw new SyllabusImportError("ai-invalid-response")
    }
    return response.parsed_output
  }
}

// Maps SDK errors to messages a student can act on. Details stay in the server log
// (status and error type only, never the syllabus text).
function toSyllabusError(error: unknown): SyllabusImportError {
  if (error instanceof SyllabusImportError) return error
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new SyllabusImportError("ai-timeout", { cause: error })
  if (error instanceof Anthropic.APIConnectionError) return new SyllabusImportError("network", { cause: error })
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    console.error("[syllabus-ai] authentication failed: check ANTHROPIC_API_KEY", { status: error.status })
    return new SyllabusImportError("ai-not-configured", { cause: error })
  }
  if (error instanceof Anthropic.RateLimitError) return new SyllabusImportError("ai-busy", { cause: error })
  if (error instanceof Anthropic.APIError) {
    console.error("[syllabus-ai] API error", { status: error.status, type: error.name })
    return new SyllabusImportError(error.status === 529 ? "ai-busy" : "ai-failed", { cause: error })
  }
  // Errors before any request was sent, most often missing credentials.
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
  console.error(
    hasKey
      ? "[syllabus-ai] request failed before reaching the API"
      : "[syllabus-ai] no credentials: set ANTHROPIC_API_KEY in .env.local"
  )
  return new SyllabusImportError(hasKey ? "ai-failed" : "ai-not-configured", { cause: error })
}
