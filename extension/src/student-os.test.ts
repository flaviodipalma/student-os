import { describe, expect, it, vi } from "vitest"
import { currentAccount, normalizeAddress, sendImport, StudentOsError, summaryLines } from "./student-os"

describe("normalizeAddress", () => {
  it("accepts HTTPS addresses in any form and keeps only the origin", () => {
    expect(normalizeAddress("studentos.app")).toBe("https://studentos.app")
    expect(normalizeAddress(" https://studentos.app/integrations?x=1 ")).toBe("https://studentos.app")
  })

  it("allows plain http only for this computer", () => {
    expect(normalizeAddress("http://localhost:3000")).toBe("http://localhost:3000")
    expect(normalizeAddress("http://127.0.0.1:3001/")).toBe("http://127.0.0.1:3001")
    expect(() => normalizeAddress("http://studentos.app")).toThrow(/https/)
  })

  it("rejects things that aren't an address", () => {
    for (const bad of ["", "hello", "https://user:pass@studentos.app", "javascript:alert(1)", "ftp://studentos.app"]) {
      expect(() => normalizeAddress(bad), bad).toThrow(StudentOsError)
    }
  })
})

describe("currentAccount", () => {
  const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch

  it("asks Student OS who is logged in, with the login cookies and the extension header", async () => {
    const fetchFn = reply(200, { firstName: "Alex" })
    expect(await currentAccount("http://localhost:3000", fetchFn)).toEqual({ firstName: "Alex" })
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]
    expect(url).toBe("http://localhost:3000/api/extension/me")
    expect(init).toMatchObject({ credentials: "include" })
    expect(new Headers(init?.headers).get("x-student-os-extension")).toBe("1")
  })

  it("logged out: an error that says so", async () => {
    await expect(currentAccount("http://localhost:3000", reply(401, { error: "Log in to Student OS in this browser, then try again.", loggedOut: true }))).rejects.toMatchObject({
      loggedOut: true,
      message: "Log in to Student OS in this browser, then try again.",
    })
  })

  it("explains when Student OS can't be reached or the address is something else", async () => {
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    await expect(currentAccount("http://localhost:3000", offline)).rejects.toThrow(/Can't reach Student OS at http:\/\/localhost:3000/)
    const html = vi.fn(async () => new Response("<html>hi</html>", { status: 200 })) as unknown as typeof fetch
    await expect(currentAccount("https://example.com", html)).rejects.toThrow(/doesn't look like Student OS/)
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
    expect(await sendImport("http://localhost:3000", canvas, "America/New_York", fetchFn)).toEqual(result)
    const [url, init] = vi.mocked(fetchFn).mock.calls[0]
    expect(url).toBe("http://localhost:3000/api/extension/canvas/import")
    expect(init).toMatchObject({ method: "POST", credentials: "include" })
    expect(new Headers(init?.headers).get("x-student-os-extension")).toBe("1")
    expect(JSON.parse(String(init?.body))).toEqual({ ...canvas, timeZone: "America/New_York" })
  })

  it("logged out is its own error; other problems show Student OS's message", async () => {
    const loggedOut = vi.fn(async () => Response.json({ error: "Log in to Student OS in this browser, then try again.", loggedOut: true }, { status: 401 })) as unknown as typeof fetch
    await expect(sendImport("http://localhost:3000", canvas, "UTC", loggedOut)).rejects.toMatchObject({ loggedOut: true })
    const limited = vi.fn(async () => Response.json({ error: "You're doing that a lot right now." }, { status: 429 })) as unknown as typeof fetch
    await expect(sendImport("http://localhost:3000", canvas, "UTC", limited)).rejects.toMatchObject({ loggedOut: false, message: "You're doing that a lot right now." })
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch")
    }) as unknown as typeof fetch
    await expect(sendImport("http://localhost:3000", canvas, "UTC", offline)).rejects.toThrow(/Can't reach Student OS/)
  })
})

describe("summaryLines", () => {
  const empty = {
    coursesCreated: 0, coursesUpdated: 0, coursesLinked: 0, coursesSkipped: 0,
    assignmentsCreated: 0, assignmentsUpdated: 0, assignmentsLinked: 0, assignmentsCompleted: 0, assignmentsWithoutDueDate: 0,
    conflicts: [], errors: [],
  }

  it("says what changed, in the Integrations page's words", () => {
    expect(summaryLines({ ...empty, coursesCreated: 4, assignmentsCreated: 31, assignmentsCompleted: 6 }, 0)).toEqual([
      "4 courses added",
      "31 assignments added as tasks",
      "6 tasks marked done (submitted in Canvas)",
    ])
    expect(summaryLines({ ...empty, assignmentsUpdated: 1, coursesSkipped: 1 }, 1)).toEqual(["1 assignment updated", "2 courses couldn't be read"])
  })

  it("nothing changed: says so", () => {
    expect(summaryLines(empty, 0)).toEqual(["Everything was already up to date."])
  })
})
