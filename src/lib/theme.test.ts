// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { applyTheme, isThemePreference, onSystemThemeChange, readThemeCookie, resolveTheme, THEME_SCRIPT } from "./theme"

// Light / Dark / System: the pre-paint script, applying a choice, and following the device.

let systemDark = false
const listeners = new Set<() => void>()
beforeEach(() => {
  systemDark = false
  listeners.clear()
  window.matchMedia = vi.fn((query: string) => ({
    get matches() {
      return query.includes("dark") && systemDark
    },
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  })) as unknown as typeof window.matchMedia
  vi.stubGlobal("requestAnimationFrame", (fn: () => void) => setTimeout(fn, 0))
  document.cookie = "sos-theme=; max-age=0; path=/"
  document.documentElement.className = ""
})
afterEach(() => vi.unstubAllGlobals())

const runScript = () => new Function(THEME_SCRIPT)()
const dark = () => document.documentElement.classList.contains("dark")

describe("theme", () => {
  it("resolves System from the device; Light and Dark are fixed", () => {
    expect(resolveTheme("system", true)).toBe("dark")
    expect(resolveTheme("system", false)).toBe("light")
    expect(resolveTheme("light", true)).toBe("light")
    expect(resolveTheme("dark", false)).toBe("dark")
    expect(isThemePreference("dark")).toBe(true)
    expect(isThemePreference("blue")).toBe(false)
  })

  it("the pre-paint script: cookie first, else System (the device)", () => {
    runScript()
    expect(dark()).toBe(false)
    systemDark = true
    runScript()
    expect(dark()).toBe(true)
    expect(document.documentElement.style.colorScheme).toBe("dark")
    document.cookie = "sos-theme=light; path=/"
    runScript()
    expect(dark()).toBe(false)
    expect(document.documentElement.getAttribute("data-theme-preference")).toBe("light")
    // Anything unexpected in the cookie is ignored (System).
    document.cookie = "sos-theme=%3Cscript%3E; path=/"
    runScript()
    expect(dark()).toBe(true)
  })

  it("applying a choice: the class and the cookie, right away", () => {
    expect(applyTheme("dark")).toBe("dark")
    expect(dark()).toBe(true)
    expect(readThemeCookie()).toBe("dark")
    applyTheme("light")
    expect(dark()).toBe(false)
    expect(readThemeCookie()).toBe("light")
  })

  it("System follows the device when it changes", () => {
    applyTheme("system")
    const stop = onSystemThemeChange(() => applyTheme(readThemeCookie()))
    systemDark = true
    listeners.forEach((fn) => fn())
    expect(dark()).toBe(true)
    systemDark = false
    listeners.forEach((fn) => fn())
    expect(dark()).toBe(false)
    stop()
    expect(listeners.size).toBe(0)
  })
})
