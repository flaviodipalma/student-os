// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import HomePage from "./page"

afterEach(cleanup)

describe("the public homepage", () => {
  it("says what Quadernio is and offers sign-up and log-in", () => {
    render(<HomePage />)
    expect(screen.getByRole("heading", { level: 1, name: "Your semester, planned for you." })).toBeTruthy()
    expect(screen.getAllByRole("link", { name: "Create your free account" })[0].getAttribute("href")).toBe("/signup")
    expect(screen.getAllByRole("link", { name: "Log in" })[0].getAttribute("href")).toBe("/login")
  })

  it("explains what's done with Google Calendar and links the Privacy Policy (Google's review reads this)", () => {
    render(<HomePage />)
    expect(screen.getByText(/Google Calendar and Outlook are read-only\./)).toBeTruthy()
    expect(screen.getByText(/never creates, changes or deletes anything in your calendar/)).toBeTruthy()
    for (const link of screen.getAllByRole("link", { name: /Privacy Policy/ })) expect(link.getAttribute("href")).toBe("/privacy")
    expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe("/terms")
  })
})
