"use client"

import { createContext, use, useCallback, useEffect, useState } from "react"
import {
  applyTheme,
  onSystemThemeChange,
  readThemeCookie,
  resolveTheme,
  systemPrefersDark,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme"

// The theme for every page (root layout). The first paint is already right (the
// inline script); this keeps it right afterwards: follows the device while the
// choice is "System", and lets Settings change it without a reload.

type ThemeContextValue = {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // The server doesn't know the cookie; "system" there, the real value right after hydrating.
  const [preference, setPreferenceState] = useState<ThemePreference>("system")
  const [resolved, setResolved] = useState<ResolvedTheme>("light")

  useEffect(() => {
    const current = readThemeCookie()
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the cookie the pre-paint script already applied
    setPreferenceState(current)
    setResolved(resolveTheme(current, systemPrefersDark()))
  }, [])

  // "System": follow the device live (e.g. it switches to dark at sunset).
  useEffect(
    () =>
      onSystemThemeChange(() => {
        const current = readThemeCookie()
        if (current === "system") setResolved(applyTheme("system"))
      }),
    []
  )

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next)
    setResolved(applyTheme(next))
  }, [])

  return <ThemeContext value={{ preference, resolved, setPreference }}>{children}</ThemeContext>
}

export function useTheme(): ThemeContextValue {
  const value = use(ThemeContext)
  if (!value) throw new Error("useTheme must be used inside ThemeProvider")
  return value
}

// A signed-in student's saved choice wins over this device's cookie (e.g. they
// picked Dark on their laptop, and now open Student OS on a new phone).
export function SavedThemeSync({ saved }: { saved: ThemePreference | null }) {
  const { setPreference } = useTheme()
  useEffect(() => {
    if (saved && saved !== readThemeCookie()) setPreference(saved)
  }, [saved, setPreference])
  return null
}
