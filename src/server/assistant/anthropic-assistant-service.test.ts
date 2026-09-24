import Anthropic from "@anthropic-ai/sdk"
import { describe, expect, it, vi } from "vitest"
import { AssistantAIError, type AssistantAIRequest } from "./ai-service"
import { AnthropicAssistantService } from "./anthropic-assistant-service"
import { MockAssistantService } from "./mock-assistant-service"

// The Claude provider's tool loop and error handling, with a stubbed SDK client
// (no request leaves the test).

type Create = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Partial<Anthropic.Message>>

function serviceWith(create: Create) {
  const client = { messages: { create: vi.fn(create) } } as unknown as Anthropic
  return { service: new AnthropicAssistantService({ client, model: "claude-opus-5" }), create: client.messages.create as ReturnType<typeof vi.fn> }
}

function request(overrides: Partial<AssistantAIRequest> = {}): AssistantAIRequest {
  return {
    system: "rules",
    context: "Now: 2026-09-22",
    messages: [{ role: "user", content: "What's due?" }],
    tools: [{ name: "getUpcomingDeadlines", description: "d", inputSchema: { type: "object", properties: {} } }],
    callTool: vi.fn(async () => ({ content: '{"count":1}', isError: false })),
    ...overrides,
  }
}

const text = (value: string): Partial<Anthropic.Message> => ({ stop_reason: "end_turn", content: [{ type: "text", text: value, citations: null }] })

describe("AnthropicAssistantService", () => {
  it("runs the tools Claude asks for and returns the final answer", async () => {
    const { service, create } = serviceWith(async (params) =>
      params.messages.length === 1
        ? { stop_reason: "tool_use", content: [{ type: "tool_use", id: "tu_1", name: "getUpcomingDeadlines", input: { days: 7 }, caller: { type: "direct" } }] as Anthropic.ContentBlock[] }
        : text("You have 1 task due this week.")
    )
    const req = request()
    await expect(service.respond(req)).resolves.toBe("You have 1 task due this week.")
    expect(req.callTool).toHaveBeenCalledWith("getUpcomingDeadlines", { days: 7 })

    const second = create.mock.calls[1][0] as Anthropic.MessageCreateParamsNonStreaming
    expect(second.messages.at(-1)).toEqual({
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "tu_1", content: '{"count":1}', is_error: false }],
    })
    // Rules cached; the per-turn context after the breakpoint.
    expect(second.system).toEqual([
      { type: "text", text: "rules", cache_control: { type: "ephemeral" } },
      { type: "text", text: "Now: 2026-09-22" },
    ])
    expect(second.thinking).toEqual({ type: "adaptive" })
  })

  it("stops a model that keeps calling tools", async () => {
    const { service, create } = serviceWith(async () => ({
      stop_reason: "tool_use",
      content: [{ type: "tool_use", id: "tu", name: "getUpcomingDeadlines", input: {}, caller: { type: "direct" } }] as Anthropic.ContentBlock[],
    }))
    await expect(service.respond(request())).rejects.toMatchObject({ kind: "too-many-steps" })
    expect(create).toHaveBeenCalledTimes(6)
  })

  it("a refusal or an empty answer is an error, not a blank message", async () => {
    await expect(serviceWith(async () => ({ stop_reason: "refusal", content: [] })).service.respond(request())).rejects.toMatchObject({ kind: "refused" })
    await expect(serviceWith(async () => ({ stop_reason: "end_turn", content: [] })).service.respond(request())).rejects.toMatchObject({ kind: "failed" })
  })

  it("maps provider failures: timeout, unavailable, rate limit, overloaded, bad key", async () => {
    const cases: [unknown, string][] = [
      [new Anthropic.APIConnectionTimeoutError(), "timeout"],
      [new Anthropic.APIConnectionError({ message: "down" }), "unavailable"],
      [new Anthropic.RateLimitError(429, undefined, "slow down", new Headers()), "busy"],
      [new Anthropic.InternalServerError(529, undefined, "overloaded", new Headers()), "busy"],
      [new Anthropic.AuthenticationError(401, undefined, "bad key", new Headers()), "not-configured"],
    ]
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const [error, kind] of cases) {
      const failure = await serviceWith(async () => {
        throw error
      })
        .service.respond(request())
        .catch((e) => e)
      expect(failure).toBeInstanceOf(AssistantAIError)
      expect(failure.kind).toBe(kind)
    }
  })
})

describe("MockAssistantService (local testing without AI)", () => {
  it("answers set questions from the real tools", async () => {
    const callTool = vi.fn(async () => ({
      content: JSON.stringify({ tasks: [{ title: "Psychology Reading", due: "Tomorrow", dueTime: null, remainingMinutes: 45 }] }),
      isError: false,
    }))
    const reply = await new MockAssistantService().respond(request({ messages: [{ role: "user", content: "What's due this week?" }], callTool }))
    expect(callTool).toHaveBeenCalledWith("getUpcomingDeadlines", { days: 7 })
    expect(reply).toBe("You have 1 task due in the next 7 days. The earliest is Psychology Reading, due Tomorrow.")
  })
})
