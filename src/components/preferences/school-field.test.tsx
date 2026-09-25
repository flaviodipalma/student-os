// @vitest-environment jsdom
import { useState } from "react"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The School field in a simulated browser. The server search is mocked.

const mocks = vi.hoisted(() => ({ search: vi.fn() }))
vi.mock("@/app/actions/schools", () => ({ searchSchoolsAction: mocks.search }))

const { SchoolField } = await import("./school-field")
type Value = { schoolName: string; schoolDomain: string | null }

const QUINNIPIAC = { name: "Quinnipiac University", domain: "qu.edu", country: "US" }
const QUINCY = { name: "Quincy University", domain: "quincy.edu", country: "US" }

let saved: Value = { schoolName: "", schoolDomain: null }
function Harness({ initial = { schoolName: "", schoolDomain: null } }: { initial?: Value }) {
  const [value, setValue] = useState<Value>(initial)
  return (
    <SchoolField
      value={value}
      onChange={(next) => {
        saved = next
        setValue(next)
      }}
    />
  )
}

beforeEach(() => {
  mocks.search.mockReset()
  mocks.search.mockResolvedValue({ ok: true, data: [QUINCY, QUINNIPIAC] })
  saved = { schoolName: "", schoolDomain: null }
})
afterEach(cleanup)

describe("School field", () => {
  it("typing 'q' lists schools starting with it (asking the server once typing pauses)", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole("combobox", { name: /School/ }), "q")
    await screen.findByRole("option", { name: /Quincy University/ })
    const list = screen.getByRole("listbox", { name: "Schools" })
    expect(list.textContent).toMatch(/Quincy University/)
    expect(list.textContent).toMatch(/Quinnipiac University/)
    expect(mocks.search).toHaveBeenCalledWith("q", expect.anything())
    expect(screen.getByRole("combobox")).toHaveProperty("ariaExpanded", "true")
  })

  it("arrow keys and Enter pick a school, with its domain", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole("combobox"), "qu")
    await screen.findByRole("option", { name: /Quinnipiac University/ })
    await user.keyboard("{ArrowDown}{ArrowDown}{Enter}")
    expect(saved).toEqual({ schoolName: "Quinnipiac University", schoolDomain: "qu.edu" })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("combobox")).toHaveProperty("value", "Quinnipiac University")
  })

  it("a click picks a school too", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole("combobox"), "quinn")
    await user.click(await screen.findByRole("option", { name: /Quinnipiac University/ }))
    expect(saved).toEqual({ schoolName: "Quinnipiac University", schoolDomain: "qu.edu" })
  })

  it("not on the list: 'Use …' keeps what was typed (no domain)", async () => {
    mocks.search.mockResolvedValue({ ok: true, data: [] })
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole("combobox"), "My Community College")
    await user.click(await screen.findByRole("option", { name: /Use .My Community College./ }))
    expect(saved).toEqual({ schoolName: "My Community College", schoolDomain: null })
  })

  it("Escape closes the list; typing after a pick forgets the picked domain", async () => {
    const user = userEvent.setup()
    render(<Harness initial={{ schoolName: "Quinnipiac University", schoolDomain: "qu.edu" }} />)
    await user.type(screen.getByRole("combobox"), " X")
    expect(saved).toEqual({ schoolName: "Quinnipiac University X", schoolDomain: null })
    await screen.findByRole("listbox")
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
  })

  it("only the newest answer counts (a slow older one is ignored)", async () => {
    let resolveSlow: (value: unknown) => void = () => {}
    mocks.search.mockImplementationOnce(() => new Promise((resolve) => (resolveSlow = resolve)))
    mocks.search.mockResolvedValue({ ok: true, data: [QUINNIPIAC] })
    const user = userEvent.setup()
    render(<Harness />)
    await user.type(screen.getByRole("combobox"), "q")
    await waitFor(() => expect(mocks.search).toHaveBeenCalledTimes(1))
    await user.type(screen.getByRole("combobox"), "uinn")
    await screen.findByRole("option", { name: /Quinnipiac University/ })
    resolveSlow({ ok: true, data: [QUINCY] })
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole("option", { name: /Quincy University/ })).toBeNull()
  })
})
