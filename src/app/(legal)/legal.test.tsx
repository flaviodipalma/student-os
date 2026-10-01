// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal"
import PrivacyPage from "./privacy/page"
import TermsPage from "./terms/page"

afterEach(cleanup)

describe("legal pages", () => {
  it("the Privacy Policy covers what Google's review and the Chrome Web Store ask for", () => {
    render(<PrivacyPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Privacy Policy" })).toBeTruthy()
    for (const section of ["What we collect", "AI features", "Who helps us run Quadernio", "Google user data", "How long we keep it", "Your choices and rights"]) {
      expect(screen.getByRole("heading", { level: 2, name: section })).toBeTruthy()
    }
    expect(screen.getByText(/Limited Use requirements/)).toBeTruthy()
    expect(screen.getByText(/Your school login never leaves your browser/)).toBeTruthy()
    expect(screen.getAllByRole("link", { name: LEGAL_CONTACT_EMAIL })[0].getAttribute("href")).toBe(`mailto:${LEGAL_CONTACT_EMAIL}`)
    expect(screen.getByRole("link", { name: "Terms of Service" }).getAttribute("href")).toBe("/terms")
  })

  it("the Terms say the school is the source of truth and link back to the Privacy Policy", () => {
    render(<TermsPage />)
    expect(screen.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeTruthy()
    expect(screen.getByText(/official course sites are always the source of truth/)).toBeTruthy()
    expect(screen.getByRole("link", { name: "Privacy Policy" }).getAttribute("href")).toBe("/privacy")
    expect(screen.getAllByRole("link", { name: LEGAL_CONTACT_EMAIL }).length).toBeGreaterThan(0)
  })
})
