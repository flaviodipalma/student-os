import { describe, expect, it, vi } from "vitest"
import { currentAccount, normalizeAddress, sendImport, QuadernioError, summaryLines } from "./quadernio"

describe("normalizeAddress", () => {
  it("accepts HTTPS addresses in any form and keeps only the origin", () => {
    expect(normalizeAddress("quadernio.app")).toBe("https://quadernio.app")
    expect(normalizeAddress(" https://quadernio.app/integrations?x=1 ")).toBe("https://quadernio.app")
  })

  it("allows plain http only for this computer", () => {
    expect(normalizeAddress("http://localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeAddress("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001")
    expect(() => normalizeAddress("http://quadernio.app")).toThrow(/https/)
  })

  it("rejects things that aren't an address", () => {
    for (const bad of ["", "hello", "https://user:pass@quadernio.app", "javascript:alert(1)", "ftp://quadernio.app"]) {
      expect(() => normalizeAddress(bad), bad).toThrow(QuadernioError)
    }
  })
})

describe("currentAccount", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it("asks Quadernio who is logged in, with the login cookies and the extension header", async () => {
    const fetchFn = reply(200, { firstName: "Alex" })
    expect(await currentAccount("http://localhost:3000", fetchFn)).toEqual({ firstName: "Alex" })
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]
    expect(url).toBe("http://localhost:3000/api/extension/me")
    expect(init).toMatchObject({ credentials: "include" })
    expect(new Headers(init?.headers).get("x-quadernio-extension")).toBe("1")
  })

  it("logged out: an error that says so", async () => {
    await expect(currentAccount("http://localhost:3000", reply(401, { error: "Log in to Quadernio in this browser, then try again.", loggedOut: true }))).rejects.toMatchObject({
      loggedOut: true,
      message: "Log in to Quadernio in this browser, then try again.",
    })
  })

  it("explains when Quadernio can't be reached or the address is something else", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    await expect(currentAccount("http://localhost:3000", offline)).rejects.toThrow(/Can't reach Quadernio at http:\/\/localhost:3000/)
    const html = vi.fn(async () => new Response("<html>hi</html>", { status: 200 })) as unknown as typeof fetch
    await expect(currentAccount("https://example.com", html)).rejects.toThrow(/doesn't look like Quadernio/)
    await expect(currentAccount("https://example.com", reply(500, "oops"))).rejects.toMatchObject({ loggedOut: false, message: expect.stringMatching(/\(500\)/) })
  })
})

describe("sendImport", () => {
  const canvas = { baseUrl: "https://school.instructure.com", courses: [{ id: 1 }], assignments: { "1": [{ id: 2 }] } }
  const result = {
    coursesCreated: 1, coursesUpdated: 0, coursesLinked: 0, coursesSkipped: 0,
    assignmentsCreated: 1, assignmentsUpdated: 0, assignmentsLinked: 0, assignmentsCompleted: 0, assignmentsWithoutDueDate: 0,
    conflicts: [], errors: [],
  }

  it("posts the Canvas data as the logged-in student, with the browser's time zone", async () => {
    const fetchFn = vi.fn(async () => Response.json({ result })) as unknown as typeof fetch
    expect(await sendImport("http://localhost:3000", "canvas", canvas, "America/New_York", fetchFn)).toEqual(result)
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]
    expect(url).toBe("http://localhost:3000/api/extension/canvas/import")
    expect(init).toMatchObject({ method: "POST", credentials: "include" })
    expect(new Headers(init?.headers).get("x-quadernio-extension")).toBe("1")
    expect(JSON.parse(String(init?.body))).toEqual({ ...canvas, timeZone: "America/New_York" })
  })

  it("Blackboard goes to its own import address, with its own fields", async () => {
    const fetchFn = vi.fn(async () => Response.json({ result })) as unknown as typeof fetch
    const blackboard = { baseUrl: "https://school.blackboard.com", courses: [{ courseId: "_1_1" }], columns: { _1_1: [] }, grades: {}, attempts: {} }
    await sendImport("http://localhost:3000", "blackboard", blackboard, "UTC", fetchFn)
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]
    expect(url).toBe("http://localhost:3000/api/extension/blackboard/import")
    expect(JSON.parse(String(init?.body))).toEqual({ ...blackboard, timeZone: "UTC" })
  })

  it("logged out is its own error; other problems show Quadernio's message", async () => {
    const loggedOut = vi.fn(async () => Response.json({ error: "Log in to Quadernio in this browser, then try again.", loggedOut: true }, { status: 401 })) as unknown as typeof fetch
    await expect(sendImport("http://localhost:3000", "canvas", canvas, "UTC", loggedOut)).rejects.toMatchObject({ loggedOut: true })
    const limited = vi.fn(async () => Response.json({ error: "You're doing that a lot right now." }, { status: 429 })) as unknown as typeof fetch
    await expect(sendImport("http://localhost:3000", "canvas", canvas, "UTC", limited)).rejects.toMatchObject({ loggedOut: false, message: "You're doing that a lot right now." })
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    await expect(sendImport("http://localhost:3000", "canvas", canvas, "UTC", offline)).rejects.toThrow(/Can't reach Quadernio/)
  })
})

describe("summaryLines", () => {
  const empty = {
    coursesCreated: 0, coursesUpdated: 0, coursesLinked: 0, coursesSkipped: 0,
    assignmentsCreated: 0, assignmentsUpdated: 0, assignmentsLinked: 0, assignmentsCompleted: 0, assignmentsWithoutDueDate: 0,
    conflicts: [], errors: [],
  }

  it("says what changed, in the Integrations page's words", () => {
    expect(summaryLines({ ...empty, coursesCreated: 4, assignmentsCreated: 31, assignmentsCompleted: 6 }, 0, "Canvas")).toEqual([
      "4 courses added",
      "31 assignments added as tasks",
      "6 tasks marked done (submitted in Canvas)",
    ])
    expect(summaryLines({ ...empty, assignmentsUpdated: 1, coursesSkipped: 1 }, 1, "Canvas")).toEqual(["1 assignment updated", "2 courses couldn't be read"])
    expect(summaryLines({ ...empty, assignmentsCompleted: 1, assignmentsLinked: 2 }, 0, "Blackboard")).toEqual([
      "2 existing tasks linked to Blackboard",
      "1 task marked done (submitted in Blackboard)",
    ])
  })

  it("nothing changed: says so", () => {
    expect(summaryLines(empty, 0, "Canvas")).toEqual(["Everything was already up to date."])
  })
})
