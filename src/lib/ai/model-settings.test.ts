import { describe, expect, it } from "vitest"
import { modelSettings } from "./model-settings"

describe("modelSettings", () => {
  it("gives Haiku 4.5 a fixed thinking budget and no fallback", () => {
    expect(modelSettings("claude-haiku-4-5")).toEqual({
      thinking: { type: "enabled", budget_tokens: 4000 },
      fallback: false,
    })
  })

  it("uses adaptive thinking for Opus and Sonnet, with the fallback on Opus 5 only", () => {
    expect(modelSettings("claude-opus-5")).toEqual({ thinking: { type: "adaptive" }, fallback: true })
    expect(modelSettings("claude-sonnet-5")).toEqual({ thinking: { type: "adaptive" }, fallback: false })
  })
})
