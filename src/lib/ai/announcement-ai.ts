import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { announcementExtractionSchema, type AnnouncementExtraction } from "@/lib/announcements/schema"
import { logger } from "@/server/log"
import { modelSettings } from "./model-settings"
import { ANNOUNCEMENTS_SYSTEM_PROMPT } from "./prompts/announcements"

// Reads new course announcements for quizzes, exams, deadlines and cancelled
// classes. Server-only: the API key never reaches the browser.
//   ANNOUNCEMENT_AI_PROVIDER (falls back to SYLLABUS_AI_PROVIDER): "anthropic"
//   (default) uses Claude; "mock" finds simple written-out dates, for tests (not AI).
//   ANNOUNCEMENT_AI_MODEL (falls back to SYLLABUS_AI_MODEL) picks the model.
// Only each announcement's course, posting date, title and text are sent: no
// names, grades or anything about other students.

export type AnnouncementForAI = {
  id: string
  // "CSC215 · Data Structures"
  course: string
  // The day it was posted, with its weekday ("Monday, 2026-10-05"), so "Thursday" can be worked out.
  posted: string
  title: string
  text: string
}

export class AnnouncementReadError extends Error {
  constructor(
    readonly reason: "not-configured" | "busy" | "failed",
    options?: ErrorOptions
  ) {
    super(reason, options)
  }
}

export interface AnnouncementAI {
  // The model's structured answer (untrusted: see toFindings).
  readAnnouncements(items: AnnouncementForAI[], context: { today: string }): Promise<unknown>
}

const DEFAULT_MODEL = "claude-opus-5-5"

export class AnthropicAnnouncementAI implements AnnouncementAI {
  private readonly client = new Anthropic({ timeout: 90_000, maxRetries: 2 })
  private readonly model = process.env.ANNOUNCEMENT_AI_MODEL ?? process.env.SYLLABUS_AI_MODEL ?? DEFAULT_MODEL

  async readAnnouncements(items: AnnouncementForAI[], context: { today: string }): Promise<AnnouncementExtraction> {
    const settings = modelSettings(this.model)
    const body = items
      .map((item) => `<announcement id="${item.id}">\nCourse: ${item.course}\nPosted: ${item.posted}\nTitle: ${item.title}\n\n${item.text}\n</announcement>`)
      .join("\n\n")
    let response
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: settings.thinking,
        system: [{ type: "text", text: ANNOUNCEMENTS_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: `Today's date is ${context.today}.\n\n<announcements>\n${body}\n</announcements>` }],
        // Structured output: the answer must match the findings schema.
        output_config: { format: betaZodOutputFormat(announcementExtractionSchema) },
        ...(settings.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      })
    } catch (error) {
      throw toReadError(error)
    }
    if (response.stop_reason === "refusal") {
      logger.warn("announcement-ai", "request declined", { category: response.stop_details?.category ?? null })
      throw new AnnouncementReadError("failed")
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      logger.warn("announcement-ai", "incomplete structured output", { stopReason: response.stop_reason })
      throw new AnnouncementReadError("failed")
    }
    return response.parsed_output
  }
}

function toReadError(error: unknown): AnnouncementReadError {
  if (error instanceof AnnouncementReadError) return error
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    logger.error("announcement-ai", "authentication failed: check ANTHROPIC_API_KEY", { status: error.status })
    return new AnnouncementReadError("not-configured", { cause: error })
  }
  if (error instanceof Anthropic.RateLimitError) return new AnnouncementReadError("busy", { cause: error })
  if (error instanceof Anthropic.APIError) {
    logger.error("announcement-ai", "API error", { status: error.status, type: error.name })
    return new AnnouncementReadError(error.status === 529 ? "busy" : "failed", { cause: error })
  }
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
  logger.error("announcement-ai", hasKey ? "request failed before reaching the API" : "no credentials: set ANTHROPIC_API_KEY")
  return new AnnouncementReadError(hasKey ? "failed" : "not-configured", { cause: error })
}

// NOT AI: finds sentences that name a kind and a written-out date (YYYY-MM-DD), for
// tests and demos (ANNOUNCEMENT_AI_PROVIDER=mock): "Quiz 3 is on 2026-10-08 at 10:00.",
// "No class on 2026-10-06." Text containing "AI DOWN" fails, like an unreachable AI.
export class MockAnnouncementAI implements AnnouncementAI {
  async readAnnouncements(items: AnnouncementForAI[]): Promise<AnnouncementExtraction> {
    if (items.some((item) => item.text.includes("AI DOWN"))) throw new AnnouncementReadError("failed")
    const findings: AnnouncementExtraction["findings"] = []
    for (const item of items) {
      for (const sentence of item.text.split(/(?<=[.!?])\s+/)) {
        const date = /\b(\d{4}-\d{2}-\d{2})\b/.exec(sentence)?.[1]
        if (!date) continue
        const time = /\bat (\d{2}:\d{2})\b/.exec(sentence)?.[1] ?? null
        const kind = /\bno class\b|\bcancel/i.test(sentence) ? "no_class" : /\bquiz/i.test(sentence) ? "quiz" : /\b(exam|midterm|final)\b/i.test(sentence) ? "exam" : /\bdue\b/i.test(sentence) ? "deadline" : null
        if (!kind) continue
        const title = kind === "no_class" ? "No class" : (sentence.match(/^[^,.]*?(?= is | on | due )/)?.[0] ?? sentence).trim().slice(0, 60)
        findings.push({ announcementId: item.id, kind, title, date, time, quote: sentence.trim() })
      }
    }
    return { findings }
  }
}

// The fake provider is configured (tests, demos).
export const usesMockAnnouncementAI = () => (process.env.ANNOUNCEMENT_AI_PROVIDER ?? process.env.SYLLABUS_AI_PROVIDER ?? "anthropic") === "mock"

export function getAnnouncementAI(): AnnouncementAI {
  if (usesMockAnnouncementAI()) {
    logger.warn("announcement-ai", "using the MOCK provider; not real AI")
    return new MockAnnouncementAI()
  }
  return new AnthropicAnnouncementAI()
}
