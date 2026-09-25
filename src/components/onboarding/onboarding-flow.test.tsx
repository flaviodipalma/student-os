// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"

// Onboarding in a simulated browser: the intro, the three detail steps, and step 4
// (connect Canvas or Blackboard through the extension, or a syllabus / by hand).
// The app store, navigation, server action and heavy children are mocked.

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  saveOnboarding: vi.fn(),
  completeOnboarding: vi.fn(),
  lmsSyncStatusAction: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))
vi.mock("@/app/actions/integrations", () => ({ lmsSyncStatusAction: mocks.lmsSyncStatusAction }))
vi.mock("@/components/syllabus/syllabus-importer", () => ({
  SyllabusImporter: () => <div>Syllabus importer</div>,
}))
vi.mock("@/components/courses/course-form-dialog", () => ({
  CourseFormDialog: ({ open }: { open: boolean }) => (open ? <div>Course form</div> : null),
}))
vi.mock("@/lib/app-store", () => ({
  useAppStore: () => ({
    student: { firstName: "Alex", lastName: "", schoolName: "", schoolDomain: null },
    preferences: DEFAULT_STUDENT_PREFERENCES,
    recurringCommitments: [],
    courses: [],
    saveOnboarding: mocks.saveOnboarding,
    completeOnboarding: mocks.completeOnboarding,
  }),
}))

const { OnboardingFlow } = await import("./onboarding-flow")

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.saveOnboarding.mockResolvedValue({ ok: true, data: { recurringCommitments: [] } })
  mocks.completeOnboarding.mockResolvedValue({ ok: true, data: null })
  mocks.lmsSyncStatusAction.mockResolvedValue({ ok: true, data: { syncedAt: null, courses: 0 } })
  delete document.documentElement.dataset.studentOsExtension
  window.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// Skips the intro (a click), then goes through the three detail steps.
async function toCourses(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByText("Welcome to Student OS!"))
  await user.click(await screen.findByRole("button", { name: "Continue" }))
  await user.click(screen.getByRole("button", { name: "Use defaults" }))
  await user.click(screen.getByRole("button", { name: "Skip for now" }))
  await screen.findByRole("heading", { name: "Connect your school" })
}

describe("the intro", () => {
  it("'Welcome to Student OS!' for 3 seconds, then 'Let's get started' for 3, then setup, on its own", () => {
    vi.useFakeTimers()
    render(<OnboardingFlow />)
    act(() => vi.advanceTimersByTime(100))
    expect(screen.getByText("Welcome to Student OS!").className).toMatch(/opacity-100/)
    expect(screen.getByText("Let's get started").className).toMatch(/opacity-0/)
    act(() => vi.advanceTimersByTime(2900)) // 3.0 s: still the welcome
    expect(screen.getByText("Welcome to Student OS!").className).toMatch(/opacity-100/)
    act(() => vi.advanceTimersByTime(600)) // 3.6 s
    expect(screen.getByText("Welcome to Student OS!").className).toMatch(/opacity-0/)
    expect(screen.getByText("Let's get started").className).toMatch(/opacity-100/)
    act(() => vi.advanceTimersByTime(2900)) // 6.5 s: still "Let's get started"
    expect(screen.getByText("Let's get started").className).toMatch(/opacity-100/)
    act(() => vi.advanceTimersByTime(600)) // 7.1 s
    expect(screen.queryByText("Welcome to Student OS!")).toBeNull()
    expect(screen.getByRole("heading", { name: "Welcome, Alex!" })).toBeTruthy()
  })

  it("a click or any key skips it", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await user.keyboard("{Enter}")
    expect(await screen.findByRole("heading", { name: "Welcome, Alex!" })).toBeTruthy()
  })
})

describe("step 4: connecting a school", () => {
  it("offers Canvas and Blackboard, and saves the details from steps 1-3 on the way", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    expect(mocks.saveOnboarding).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Connect Canvas" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Connect Blackboard" })).toBeTruthy()
    expect(screen.getByText("Step 4 of 4")).toBeTruthy()
  })

  it("Skip: a pop-up offering a syllabus, a course by hand, or skipping for now", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Skip" }))
    expect(await screen.findByRole("heading", { name: "Add your classes with a syllabus" })).toBeTruthy()

    await user.click(screen.getByRole("button", { name: "Upload syllabus" }))
    expect(await screen.findByText("Syllabus importer")).toBeTruthy()
    expect(screen.getByRole("heading", { name: "Add your courses" })).toBeTruthy()
  })

  it("Skip -> Add a course by hand opens the course form", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Skip" }))
    await user.click(await screen.findByRole("button", { name: "Add a course by hand" }))
    expect(await screen.findByText("Course form")).toBeTruthy()
  })

  it("Skip -> Skip for now finishes setup and opens the Dashboard", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Skip" }))
    await user.click(await screen.findByRole("button", { name: "Skip for now" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"))
    expect(mocks.completeOnboarding).toHaveBeenCalledOnce()
  })
})

describe("connecting through the extension", () => {
  it("Connect: get the extension; once it's installed, the tutorial starts on its own", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Connect Blackboard" }))
    expect(await screen.findByRole("heading", { name: "Get the Student OS extension" })).toBeTruthy()
    expect(screen.getByText(/Waiting for the extension/)).toBeTruthy()

    // The extension marks the page (extension/src/marker.ts).
    act(() => {
      document.documentElement.dataset.studentOsExtension = "0.1.0"
      document.dispatchEvent(new CustomEvent("student-os-extension"))
    })
    expect(await screen.findByRole("heading", { name: "Sync your Blackboard courses" })).toBeTruthy()
    expect(screen.getByText("Open your Blackboard in another tab")).toBeTruthy()
    expect(screen.getByText("Click the Student OS extension")).toBeTruthy()
    expect(screen.getByText("Click Sync now")).toBeTruthy()
  })

  it("already installed: straight to the tutorial", async () => {
    document.documentElement.dataset.studentOsExtension = "0.1.0"
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Connect Canvas" }))
    expect(await screen.findByRole("heading", { name: "Sync your Canvas courses" })).toBeTruthy()
  })

  it("waits for the first sync, then 'Your courses are in!' and the Dashboard", async () => {
    document.documentElement.dataset.studentOsExtension = "0.1.0"
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Connect Canvas" }))
    await screen.findByText(/Waiting for your Canvas courses/)
    expect(mocks.lmsSyncStatusAction).toHaveBeenCalledWith("canvas")
    expect(mocks.push).not.toHaveBeenCalled()

    mocks.lmsSyncStatusAction.mockResolvedValue({ ok: true, data: { syncedAt: new Date().toISOString(), courses: 4 } })
    expect(await screen.findByText(/Your courses are in! 4 courses from Canvas/, {}, { timeout: 5000 })).toBeTruthy()
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"), { timeout: 4000 })
    expect(mocks.completeOnboarding).toHaveBeenCalledOnce()
  })

  it("'I'll do this later' finishes setup; Back returns to the choice", async () => {
    const user = userEvent.setup()
    render(<OnboardingFlow />)
    await toCourses(user)
    await user.click(screen.getByRole("button", { name: "Connect Canvas" }))
    await user.click(await screen.findByRole("button", { name: "Back" }))
    expect(await screen.findByRole("heading", { name: "Connect your school" })).toBeTruthy()
    await user.click(screen.getByRole("button", { name: "Connect Canvas" }))
    await user.click(await screen.findByRole("button", { name: "I'll do this later" }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"))
  })
})
