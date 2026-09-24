"use client"

import { useState } from "react"
import { updateThemeAction } from "@/app/actions/settings"
import type { ThemePreference } from "@/lib/theme"
import { useTheme } from "./theme-provider"

// Choosing Light / Dark / System (the header menu and Settings > Appearance):
// applies at once on this device, then saves it to the student's account.
export function useThemeChoice() {
  const theme = useTheme()
  const [saveError, setSaveError] = useState<string | null>(null)

  async function choose(value: ThemePreference) {
    setSaveError(null)
    theme.setPreference(value)
    const result = await updateThemeAction(value).catch(() => null)
    if (!result?.ok) setSaveError("Your choice applies on this device, but we couldn't save it to your account. Please try again.")
  }

  return { ...theme, choose, saveError }
}
