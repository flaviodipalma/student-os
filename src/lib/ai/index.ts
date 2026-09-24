import "server-only"

import { AnthropicSyllabusService } from "./anthropic-syllabus-service"
import { MockSyllabusService } from "./mock-syllabus-service"
import type { SyllabusAIService } from "./syllabus-ai-service"
import { logger } from "@/server/log"

export type { SyllabusAIService, SyllabusAIContext } from "./syllabus-ai-service"

// Picks the syllabus AI provider from the environment:
//   SYLLABUS_AI_PROVIDER=anthropic (default) uses Claude and needs ANTHROPIC_API_KEY
//   SYLLABUS_AI_PROVIDER=mock      pattern matcher for local testing (not AI)
export function getSyllabusAIService(): SyllabusAIService {
  const provider = process.env.SYLLABUS_AI_PROVIDER ?? "anthropic"
  if (provider === "mock") {
    logger.warn("syllabus-ai", "using the MOCK provider (SYLLABUS_AI_PROVIDER=mock); not real AI")
    return new MockSyllabusService()
  }
  return new AnthropicSyllabusService()
}
