"use client"

import { useState } from "react"
import { SimpleSelect } from "@/components/form-fields"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import type { NotificationPreferences } from "@/lib/types"
import { reminderMinuteOptions } from "@/lib/types"

// The reminder settings in Settings > Notifications. Desktop notifications ask the
// browser for permission only when the student turns them on here (never on load),
// and Student OS works the same without them (the bell always has every reminder).

const timingLabel: Record<(typeof reminderMinuteOptions)[number], string> = {
  5: "5 minutes before",
  15: "15 minutes before",
  30: "30 minutes before",
  60: "1 hour before",
  1440: "1 day before",
}

const kinds: { key: keyof NotificationPreferences; label: string; hint: string }[] = [
  { key: "taskReminders", label: "Task due reminders", hint: "Before a task is due (and a day ahead for high-priority work)." },
  { key: "studySessionReminders", label: "Study session reminders", hint: "Before a planned study session, and if one is missed." },
  { key: "eventReminders", label: "Calendar event reminders", hint: "Your events, recurring commitments, and Canvas or Blackboard events." },
  { key: "overdueReminders", label: "Overdue task reminders", hint: "Once, when a task passes its due time." },
  { key: "dailyPlanReminder", label: "Daily plan reminder", hint: "Once a day, when your study window starts." },
]

type Permission = NotificationPermission | "unsupported"

function browserPermission(): Permission {
  return typeof window !== "undefined" && "Notification" in window ? Notification.permission : "unsupported"
}

function CheckRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string
  label: string
  hint?: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className={disabled ? "text-muted-foreground" : undefined}>
          {label}
        </Label>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </div>
  )
}

export function NotificationSettingsFields({
  value,
  onChange,
}: {
  value: NotificationPreferences
  onChange: (next: NotificationPreferences) => void
}) {
  const [permissionNote, setPermissionNote] = useState<string | null>(null)
  const off = !value.enabled

  // Asks the browser only now, because the student chose to turn desktop notifications on.
  async function toggleDesktop(checked: boolean) {
    setPermissionNote(null)
    if (!checked) return onChange({ ...value, browserNotifications: false })
    let permission = browserPermission()
    if (permission === "unsupported") {
      return setPermissionNote("This browser doesn't support desktop notifications. You'll still see every reminder in Student OS.")
    }
    if (permission === "default") permission = await Notification.requestPermission().catch(() => "denied" as const)
    if (permission !== "granted") {
      return setPermissionNote(
        "Desktop notifications are blocked for this site. You can allow them in your browser's site settings; reminders still show in Student OS."
      )
    }
    onChange({ ...value, browserNotifications: true })
  }

  return (
    <div className="space-y-5">
      <CheckRow
        id="notifications-enabled"
        label="Notifications"
        hint="Turn all reminders on or off."
        checked={value.enabled}
        onChange={(enabled) => onChange({ ...value, enabled })}
      />
      <fieldset className="space-y-4 border-l pl-4" disabled={off}>
        <legend className="sr-only">Which reminders</legend>
        {kinds.map((kind) => (
          <CheckRow
            key={kind.key}
            id={`notifications-${kind.key}`}
            label={kind.label}
            hint={kind.hint}
            checked={value[kind.key] === true}
            disabled={off}
            onChange={(checked) => onChange({ ...value, [kind.key]: checked })}
          />
        ))}
        <div className="grid max-w-xs gap-1.5">
          <Label htmlFor="notifications-timing">Remind me</Label>
          <SimpleSelect
            id="notifications-timing"
            value={String(value.reminderMinutes)}
            onChange={(minutes) => onChange({ ...value, reminderMinutes: Number(minutes) })}
            options={reminderMinuteOptions.map((minutes) => ({ value: String(minutes), label: timingLabel[minutes] }))}
          />
        </div>
        <CheckRow
          id="notifications-desktop"
          label="Enable desktop notifications"
          hint="Shows new reminders on your computer while Student OS is open in a browser tab."
          checked={value.browserNotifications}
          disabled={off}
          onChange={toggleDesktop}
        />
        {permissionNote && (
          <p role="status" className="text-xs text-warning">
            {permissionNote}
          </p>
        )}
      </fieldset>
    </div>
  )
}
