"use client"

import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react"
import { useThemeChoice } from "@/components/theme/use-theme-choice"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ThemePreference } from "@/lib/theme"
import { cn } from "@/lib/utils"

// Settings > Appearance: Light / Dark / System (also in the header's theme menu). The change shows immediately
// (this device) and is saved to the student's account (their other devices).
// Native radio buttons: arrow keys and screen readers work as expected.

const options: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
]

export function AppearanceCard() {
  const { preference, resolved, choose, saveError: error } = useThemeChoice()

  return (
    <Card id="appearance">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Appearance</CardTitle>
        <CardDescription>Choose how Student OS looks. It changes right away.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Theme</legend>
          <div className="grid max-w-md grid-cols-3 gap-2">
            {options.map(({ value, label, icon: Icon }) => {
              const selected = preference === value
              return (
                <label
                  key={value}
                  className={cn(
                    "relative flex cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-sm font-medium transition-colors",
                    "has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                    selected
                      ? "border-primary bg-primary-soft text-primary-soft-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground"
                  )}
                >
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={selected}
                    onChange={() => choose(value)}
                    className="sr-only"
                  />
                  <Icon aria-hidden className="size-5" />
                  {label}
                </label>
              )
            })}
          </div>
        </fieldset>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {preference === "system"
            ? `System follows your device's appearance setting (${resolved === "dark" ? "dark" : "light"} right now).`
            : `Student OS always uses the ${preference} theme.`}
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
