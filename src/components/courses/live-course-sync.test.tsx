// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Course } from "@/lib/types"

// Courses imported by the extension appear right away, and new ones ask for their
// class times, on any page. The app store is mocked.

const stored = new Map<string, string>()
vi.stubGlobal("localStorage", {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => void stored.set(key, value),
  removeItem: (key: string) => void stored.delete(key),
  clear: () => stored.clear(),
})

const DS: Course = { id: "c1", code: "CSC 215", name: "Data Structures", professor: "", description: "", color: "sky" }
const CALC: Course = { id: "c2", code: "MAT 141", name: "Calculus I", professor: "", description: "", color: "rose" }
const ART: Course = { id: "c3", code: "ART 101", name: "Art History", professor: "", description: "", color: "violet", online: true }

const state = vi.hoisted(() => ({ courses: [] as Course[], reloadCourses: vi.fn() }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    today: "2026-09-25",
    courses: state.courses,
    recurringCommitments: [],
    reloadCourses: state.reloadCourses,
    setClassTimes: vi.fn(),
  }),
}))

const { LiveCourseSync } = await import("./live-course-sync")

beforeEach(() => {
  stored.clear()
  state.courses = [DS]
  state.reloadCourses.mockReset()
  window.scrollTo = vi.fn()
})
afterEach(cleanup)

const synced = () => act(() => void document.dispatchEvent(new CustomEvent("student-os-synced")))

describe("live refresh after an extension sync", () => {
  it("the extension's signal reloads the courses; a new one opens 'add class times' (online ones don't)", async () => {
    state.reloadCourses.mockResolvedValue([DS, CALC, ART])
    render(<LiveCourseSync />)
    expect(screen.queryByRole("dialog")).toBeNull()
    synced()
    await waitFor(() => expect(state.reloadCourses).toHaveBeenCalledOnce())
    expect(await screen.findByRole("dialog")).toBeTruthy()
    expect(screen.getByText("Course 1 of 1")).toBeTruthy()
    expect(screen.getByText("Calculus I")).toBeTruthy()
  })

  it("nothing new: no pop-up", async () => {
    state.reloadCourses.mockResolvedValue([DS])
    render(<LiveCourseSync />)
    synced()
    await waitFor(() => expect(state.reloadCourses).toHaveBeenCalledOnce())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("coming back to the tab checks too, but not more than every 30 seconds", async () => {
    state.reloadCourses.mockResolvedValue([DS])
    vi.useFakeTimers({ toFake: ["Date"] })
    try {
      render(<LiveCourseSync />)
      const visible = () => act(() => void document.dispatchEvent(new Event("visibilitychange")))
      visible()
      expect(state.reloadCourses).not.toHaveBeenCalled()
      vi.setSystemTime(Date.now() + 31_000)
      visible()
      await waitFor(() => expect(state.reloadCourses).toHaveBeenCalledOnce())
      visible()
      expect(state.reloadCourses).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
