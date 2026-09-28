import "server-only"

import Anthropic from "@anthropic-ai/sdk"
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod"
import { calendarExtractionSchema, type CalendarExtraction } from "@/lib/academic-calendar-ai/schema"
import { logger } from "@/server/log"
import { modelSettings } from "./model-settings"
import { ACADEMIC_CALENDAR_SYSTEM_PROMPT } from "./prompts/academic-calendar"

// Reads an academic calendar's text into semesters, days without classes, exams and
// deadlines. Server-only: the API key never reaches the browser.
//   ACADEMIC_CALENDAR_AI_PROVIDER (falls back to SYLLABUS_AI_PROVIDER): "anthropic"
//   (default) uses Claude; "mock" returns a fixed calendar for tests (not AI).
//   ACADEMIC_CALENDAR_AI_MODEL (falls back to SYLLABUS_AI_MODEL) picks the model.

export type CalendarAIContext = { today: string; schoolName: string }

export class CalendarReadError extends Error {
  constructor(
    readonly reason: "not-configured" | "busy" | "failed",
    options?: ErrorOptions
  ) {
    super(reason, options)
  }
}

export interface AcademicCalendarAI {
  // The model's structured answer (untrusted: see toAcademicEvents).
  readCalendar(text: string, context: CalendarAIContext): Promise<unknown>
}

const DEFAULT_MODEL = "claude-opus-5"

export class AnthropicAcademicCalendarAI implements AcademicCalendarAI {
  private readonly client = new Anthropic({ timeout: 90_000, maxRetries: 2 })
  private readonly model = process.env.ACADEMIC_CALENDAR_AI_MODEL ?? process.env.SYLLABUS_AI_MODEL ?? DEFAULT_MODEL

  async readCalendar(text: string, context: CalendarAIContext): Promise<CalendarExtraction> {
    const settings = modelSettings(this.model)
    let response
    try {
      response = await this.client.beta.messages.parse({
        model: this.model,
        max_tokens: 16000,
        thinking: settings.thinking,
        system: [{ type: "text", text: ACADEMIC_CALENDAR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: `Today's date is ${context.today}. The school is ${context.schoolName}.\n\n<calendar>\n${text}\n</calendar>`,
          },
        ],
        // Structured output: the answer must match the calendar schema.
        output_config: { format: betaZodOutputFormat(calendarExtractionSchema) },
        ...(settings.fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      })
    } catch (error) {
      throw toReadError(error)
    }
    if (response.stop_reason === "refusal") {
      logger.warn("academic-calendar-ai", "request declined", { category: response.stop_details?.category ?? null })
      throw new CalendarReadError("failed")
    }
    if (response.stop_reason === "max_tokens" || response.parsed_output == null) {
      logger.warn("academic-calendar-ai", "incomplete structured output", { stopReason: response.stop_reason })
      throw new CalendarReadError("failed")
    }
    return response.parsed_output
  }
}

function toReadError(error: unknown): CalendarReadError {
  if (error instanceof CalendarReadError) return error
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    logger.error("academic-calendar-ai", "authentication failed: check ANTHROPIC_API_KEY", { status: error.status })
    return new CalendarReadError("not-configured", { cause: error })
  }
  if (error instanceof Anthropic.RateLimitError) return new CalendarReadError("busy", { cause: error })
  if (error instanceof Anthropic.APIError) {
    logger.error("academic-calendar-ai", "API error", { status: error.status, type: error.name })
    return new CalendarReadError(error.status === 529 ? "busy" : "failed", { cause: error })
  }
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN)
  logger.error("academic-calendar-ai", hasKey ? "request failed before reaching the API" : "no credentials: set ANTHROPIC_API_KEY")
  return new CalendarReadError(hasKey ? "failed" : "not-configured", { cause: error })
}

// NOT AI: a fixed Fall / Spring calendar for the academic year around `today`, for
// tests and demos (ACADEMIC_CALENDAR_AI_PROVIDER=mock). Text containing "NOT A
// CALENDAR" reads as not found.
export class MockAcademicCalendarAI implements AcademicCalendarAI {
  async readCalendar(text: string, context: CalendarAIContext): Promise<CalendarExtraction> {
    if (!text.trim() || text.includes("NOT A CALENDAR")) return { found: false, items: [] }
    const year = Number(context.today.slice(0, 4))
    const fall = Number(context.today.slice(5, 7)) >= 6 ? year : year - 1
    const spring = fall + 1
    const f = `Fall ${fall}`
    const s = `Spring ${spring}`
    return {
      found: true,
      items: [
        { term: f, kind: "term", title: f, startDate: `${fall}-08-24`, endDate: `${fall}-12-18` },
        { term: f, kind: "no_classes", title: "Labor Day", startDate: `${fall}-09-07`, endDate: `${fall}-09-07` },
        { term: f, kind: "deadline", title: "Last day to withdraw", startDate: `${fall}-11-02`, endDate: `${fall}-11-02` },
        { term: f, kind: "no_classes", title: "Thanksgiving recess", startDate: `${fall}-11-25`, endDate: `${fall}-11-29` },
        { term: f, kind: "exams", title: "Final exams", startDate: `${fall}-12-14`, endDate: `${fall}-12-18` },
        { term: s, kind: "term", title: s, startDate: `${spring}-01-25`, endDate: `${spring}-05-14` },
        { term: s, kind: "no_classes", title: "Spring break", startDate: `${spring}-03-15`, endDate: `${spring}-03-20` },
        { term: s, kind: "exams", title: "Final exams", startDate: `${spring}-05-10`, endDate: `${spring}-05-14` },
      ],
    }
  }
}

// The fake provider is configured (tests, demos).
export const usesMockAcademicCalendarAI = () =>
  (process.env.ACADEMIC_CALENDAR_AI_PROVIDER ?? process.env.SYLLABUS_AI_PROVIDER ?? "anthropic") === "mock"

export function getAcademicCalendarAI(): AcademicCalendarAI {
  if (usesMockAcademicCalendarAI()) {
    logger.warn("academic-calendar-ai", "using the MOCK provider; not real AI")
    return new MockAcademicCalendarAI()
  }
  return new AnthropicAcademicCalendarAI()
}
