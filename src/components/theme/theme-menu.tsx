"use client"

import { MonitorIcon, MoonIcon, SunIcon, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { isThemePreference, type ThemePreference } from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useThemeChoice } from "./use-theme-choice"

// The theme button next to the notification bell: a small menu with Light /
// Dark / System. Saved to the student's account (their other devices).

const options: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "light", label: "Light", icon: SunIcon },
  { value: "dark", label: "Dark", icon: MoonIcon },
  { value: "system", label: "System", icon: MonitorIcon },
]

export function ThemeMenu({ className }: { className?: string }) {
  const { preference, resolved, choose } = useThemeChoice()
  // The button shows what's on screen now (a moon in the dark, a sun in the light).
  const Icon = resolved === "dark" ? MoonIcon : SunIcon
  const current = options.find((option) => option.value === preference)?.label ?? "System"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" className={cn(className)} />}
        aria-label={`Theme: ${current}`}
      >
        <Icon className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={preference} onValueChange={(value) => isThemePreference(value) && choose(value)}>
            {options.map(({ value, label, icon: OptionIcon }) => (
              <DropdownMenuRadioItem key={value} value={value}>
                <OptionIcon aria-hidden />
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
