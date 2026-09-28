import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ReadCalendarResponse } from "@/lib/types"

// POST /api/academic-calendar/read: signed-in students only, limited, three modes.
// The calendar service itself is mocked (tested in src/server/academic-calendar).

const state = vi.hoisted(() => ({
  userId: null as string | null,
  profile: { firstName: "Alex", lastName: "", schoolName: "Quinnipiac University", schoolDomain: "qu.edu" as string | null, onboardingCompleted: true },
  school: vi.fn(),
  link: vi.fn(),
  pdf: vi.fn(),
}))
vi.mock("@/server/auth", () => ({ getCurrentUser: async () => (state.userId ? { id: state.userId, email: null } : null) }))
vi.mock("@/server/db", () => ({ getDb: () => ({}) }))
vi.mock("@/server/services/profiles", () => ({ getProfile: async () => state.profile }))
vi.mock("@/server/academic-calendar", () => ({ calendarFromSchoolWebsite: state.school, calendarFromLink: state.link, calendarFromPdf: state.pdf }))

const { POST } = await import("./route")
const { FetchRefused } = await import("@/server/academic-calendar/safe-fetch")
const { CalendarReadError } = await import("@/lib/ai/academic-calendar-ai")

const FOUND = { status: "found", events: [{ kind: "no_classes", title: "Labor Day", startDate: "2026-09-07", endDate: "2026-09-07" }], sources: ["https://www.qu.edu/x"] }

let n = 0
function post(fields: Record<string, string | Blob>) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.set(key, value)
  return POST(new Request("http://localhost/api/academic-calendar/read", { method: "POST", body: form }))
}
const json = async (response: Response) => (await response.json()) as ReadCalendarResponse

beforeEach(() => {
  // A new student each test (the rate limit is per student).
  state.userId = `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`
  state.profile.schoolDomain = "qu.edu"
  for (const fn of [state.school, state.link, state.pdf]) fn.mockReset()
  state.school.mockResolvedValue(FOUND)
  state.link.mockResolvedValue(FOUND)
  state.pdf.mockResolvedValue({ status: "not_found" })
})

describe("reading an academic calendar", () => {
  it("needs a signed-in student", async () => {
    state.userId = null
    const response = await post({ mode: "school" })
    expect(response.status).toBe(401)
    expect(state.school).not.toHaveBeenCalled()
  })

  it("the school's website: the student's own domain and school name", async () => {
    const response = await post({ mode: "school", today: new Date().toISOString().slice(0, 10) })
    expect(await json(response)).toEqual({ ok: true, proposal: FOUND })
    expect(state.school).toHaveBeenCalledWith(expect.anything(), "qu.edu", expect.objectContaining({ schoolName: "Quinnipiac University" }))
  })

  it("without a school website: asks for it", async () => {
    state.profile.schoolDomain = null
    expect(await json(await post({ mode: "school" }))).toMatchObject({ ok: false, message: expect.stringMatching(/website/) })
  })

  it("a pasted link; a refused address says why", async () => {
    expect(await json(await post({ mode: "link", url: "https://x.edu/cal" }))).toMatchObject({ ok: true })
    state.link.mockRejectedValue(new FetchRefused("Only https:// addresses can be read."))
    const refused = await post({ mode: "link", url: "http://x.edu/cal" })
    expect(refused.status).toBe(400)
    expect(await json(refused)).toEqual({ ok: false, message: "Only https:// addresses can be read." })
  })

  it("a PDF upload: only real PDFs", async () => {
    const pdf = new File([new TextEncoder().encode("%PDF-1.7 ...")], "calendar.pdf", { type: "application/pdf" })
    expect(await json(await post({ mode: "pdf", file: pdf }))).toEqual({ ok: true, proposal: { status: "not_found" } })
    const notPdf = new File([new TextEncoder().encode("hello")], "calendar.pdf", { type: "application/pdf" })
    expect(await json(await post({ mode: "pdf", file: notPdf }))).toEqual({ ok: false, message: "That isn't a PDF file." })
  })

  it("AI trouble gets a plain message", async () => {
    state.school.mockRejectedValue(new CalendarReadError("busy"))
    expect(await json(await post({ mode: "school" }))).toEqual({ ok: false, message: "Student OS is busy right now. Try again in a minute." })
  })

  it("limited per student (each read can be an AI request)", async () => {
    for (let i = 0; i < 8; i++) expect((await post({ mode: "school" })).status).toBe(200)
    expect((await post({ mode: "school" })).status).toBe(429)
  })
})
