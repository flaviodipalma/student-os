// Request settings that differ by model. Switch models with SYLLABUS_AI_MODEL in .env.local.
export function modelSettings(model: string) {
  // Haiku 4.5 doesn't support adaptive thinking; it takes a fixed thinking budget.
  if (model.startsWith("claude-haiku-4")) {
    return { thinking: { type: "enabled" as const, budget_tokens: 4000 }, fallback: false }
  }
  // Opus 5: if a safety classifier declines, retry server-side on Anthropic's
  // recommended fallback model. Other models go without it.
  return { thinking: { type: "adaptive" as const }, fallback: model === "claude-opus-5" }
}
