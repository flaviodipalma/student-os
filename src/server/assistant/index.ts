import "server-only"

import type { StudentAssistantAIService } from "./ai-service"
import { AnthropicAssistantService } from "./anthropic-assistant-service"
import { MockAssistantService } from "./mock-assistant-service"
import { logger } from "@/server/log"

// Picks the Assistant's AI provider from the server environment (same setup as
// the syllabus importer, which it follows unless set on its own):
//   ASSISTANT_AI_PROVIDER=anthropic (default) uses Claude and needs ANTHROPIC_API_KEY
//   ASSISTANT_AI_PROVIDER=mock      set answers for local testing (not AI)
//   ASSISTANT_AI_MODEL              the Claude model (default: SYLLABUS_AI_MODEL, then claude-opus-5)
export function getAssistantAIService(): StudentAssistantAIService {
  const provider = process.env.ASSISTANT_AI_PROVIDER ?? process.env.SYLLABUS_AI_PROVIDER ?? "anthropic"
  if (provider === "mock") {
    logger.warn("assistant-ai", "using the MOCK provider; not real AI")
    return new MockAssistantService()
  }
  return new AnthropicAssistantService()
}
