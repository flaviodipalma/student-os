// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AcademicEvent } from "@/lib/types"

// The Dashboard's "At school" card. The app store is mocked.

const state = vi.hoisted(() => ({ today: "2026-11-24", events: [] as AcademicEvent[] }))
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a> }))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({ today: state.today, academicEvents: state.events, student: { schoolName: "Quinnipiac University" } }),
}))

const { AcademicHeadsUp } = await import("./academic-heads-up")
afterEach(cleanup)

describe("At school", () => {
  it("a break going on and finals coming, in words", () => {
    state.events = [
      { id: "e3", kind: "no_classes", title: "Thanksgiving recess", startDate: "2026-11-23", endDate: "2026-11-28" },
      { id: "e4", kind: "exams", title: "Final exams", startDate: "2026-12-07", endDate: "2026-12-12" },
    ]
    render(<AcademicHeadsUp />)
    expect(screen.getByText("Quinnipiac University, the next two weeks")).toBeTruthy()
    expect(screen.getByText("Thanksgiving recess").nextElementSibling?.textContent).toBe("No classes until Sat, Nov 28")
    expect(screen.getByText("Final exams").nextElementSibling?.textContent).toBe("In 13 days · Mon, Dec 7 – Sat, Dec 12")
    expect(screen.getByRole("link", { name: "Academic calendar" }).getAttribute("href")).toBe("/calendar?view=academic")
  })

  it("nothing coming up (or no calendar): no card", () => {
    state.events = []
    const { container } = render(<AcademicHeadsUp />)
    expect(container.textContent).toBe("")
  })
})
