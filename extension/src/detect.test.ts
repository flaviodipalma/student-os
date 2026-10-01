import { describe, expect, it, vi } from "vitest"
import { identifyLms } from "./detect"

// identifyLms against fake sites: each LMS answers its own API the way the real
// one does (TEST FIXTURES); any other site answers with HTML or its own errors.

const ORIGIN = "https://school.example.edu"
type Route = { status: number; body: unknown }
const site = (routes: Record<string, Route>) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const route = routes[url.pathname]
    if (!route) return new Response("<html>Not found</html>", { status: 404, headers: { "Content-Type": "text/html" } })
    return new Response(typeof route.body === "string" ? route.body : JSON.stringify(route.body), { status: route.status })
  }) as unknown as typeof fetch

describe("identifyLms", () => {
  it("Canvas, logged in or out (Canvas may prefix its JSON with while(1);)", async () => {
    expect(await identifyLms(ORIGIN, site({ "/api/v1/users/self": { status: 200, body: 'while(1);{"id":42,"name":"Alice"}' } }))).toEqual({ lms: "canvas", loggedIn: true })
    expect(await identifyLms(ORIGIN, site({ "/api/v1/users/self": { status: 401, body: { status: "unauthenticated", errors: [{ message: "user authorization required" }] } } }))).toEqual({
      lms: "canvas",
      loggedIn: false,
    })
  })

  it("Blackboard, logged in or out", async () => {
    expect(await identifyLms(ORIGIN, site({ "/learn/api/public/v1/users/me": { status: 200, body: { id: "_42_1" } } }))).toEqual({ lms: "blackboard", loggedIn: true })
    expect(await identifyLms(ORIGIN, site({ "/learn/api/public/v1/users/me": { status: 401, body: { status: 401, message: "API request is not authenticated." } } }))).toEqual({
      lms: "blackboard",
      loggedIn: false,
    })
  })

  it("Brightspace/D2L on any address, logged in, logged out, or can't tell", async () => {
    const versions = { "/d2l/api/versions/": { status: 200, body: [{ ProductCode: "lp", LatestVersion: "1.46" }, { ProductCode: "le", LatestVersion: "1.78" }] } }
    expect(await identifyLms(ORIGIN, site({ ...versions, "/d2l/api/lp/1.46/users/whoami": { status: 200, body: { Identifier: "300" } } }))).toEqual({ lms: "brightspace", loggedIn: true })
    expect(await identifyLms(ORIGIN, site({ ...versions, "/d2l/api/lp/1.46/users/whoami": { status: 401, body: {} } }))).toEqual({ lms: "brightspace", loggedIn: false })
    // Some schools accept only tokens here: it's Brightspace, Sync finds out the rest.
    expect(await identifyLms(ORIGIN, site({ ...versions, "/d2l/api/lp/1.46/users/whoami": { status: 403, body: {} } }))).toEqual({ lms: "brightspace", loggedIn: null })
  })

  it("any other site isn't an LMS, even one that answers 401 or JSON on those addresses", async () => {
    expect(await identifyLms(ORIGIN, site({}))).toEqual({ lms: null })
    expect(
      await identifyLms(
        ORIGIN,
        site({
          "/api/v1/users/self": { status: 401, body: { error: "login required" } },
          "/learn/api/public/v1/users/me": { status: 200, body: { id: "not-a-learn-id" } },
          "/d2l/api/versions/": { status: 200, body: { versions: [] } },
        })
      )
    ).toEqual({ lms: null })
    const offline = vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))) as unknown as typeof fetch
    expect(await identifyLms(ORIGIN, offline)).toEqual({ lms: null })
  })
})
