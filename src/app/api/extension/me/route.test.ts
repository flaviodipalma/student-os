import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/server/db/types"
import { createTestDb } from "@/server/test-utils/test-db"

// Who the extension will sync to, as real HTTP requests to the route. The
// logged-in student comes from the (mocked) verified session.

const state = vi.hoisted(() => ({ db: null as unknown, userId: null as string | null }))
vi.mock("@/server/db", () => ({ getDb: () => state.db }))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (state.userId ? { id: state.userId, email: null } : null) }))

const { GET } = await import("./route")

const EXTENSION = { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", "X-Student-OS-Extension": "1" }
const get = async (userId: string | null, headers: Record<string, string> = EXTENSION) => {
  state.userId = userId
  const response = await GET(new Request("http://localhost:3000/api/extension/me", { headers }))
  return { status: response.status, body: await response.json() }
}

let t: Awaited<ReturnType<typeof createTestDb>>
beforeEach(async () => {
  t = await createTestDb()
  state.db = t.db as Database
})
afterEach(() => {
  state.userId = null
  return t.close()
})

describe("GET /api/extension/me", () => {
  it("names the logged-in student, and nothing else", async () => {
    expect(await get(await t.addUser("Alex"))).toEqual({ status: 200, body: { firstName: "Alex" } })
  })

  it("401 with loggedOut when nobody is logged in in this browser", async () => {
    expect(await get(null)).toMatchObject({ status: 401, body: { loggedOut: true } })
  })

  it("403 for anything that isn't the extension", async () => {
    const alex = await t.addUser("Alex")
    expect(await get(alex, {})).toMatchObject({ status: 403 })
    expect(await get(alex, { Origin: "https://evil.example.com", "X-Student-OS-Extension": "1" })).toMatchObject({ status: 403 })
    expect(await get(alex, { Origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" })).toMatchObject({ status: 403 })
  })

  it("Chrome sends the extension's GETs without an Origin: the header is enough", async () => {
    expect(await get(await t.addUser("Alex"), { "X-Student-OS-Extension": "1" })).toEqual({ status: 200, body: { firstName: "Alex" } })
  })
})
