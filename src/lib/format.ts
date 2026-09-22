// Formatting helpers. They run on the server so the text matches on first render.

const MS_PER_DAY = 24 * 60 * 60 * 1000

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

// Date keys are "YYYY-MM-DD" strings in the student's local calendar.
export function toDateKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export function fromDateKey(key: string, time = "00:00"): Date {
  const [y, m, d] = key.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  return new Date(y, m - 1, d, hours, minutes)
}

export function addDays(key: string, days: number): string {
  const date = fromDateKey(key)
  date.setDate(date.getDate() + days)
  return toDateKey(date)
}

// Calendar days between two dates (0 = same day, 1 = tomorrow).
export function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / MS_PER_DAY)
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function formatLongDate(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

export function formatWeekday(date: Date, style: "long" | "short" | "narrow" = "long"): string {
  return date.toLocaleDateString("en-US", { weekday: style })
}

// "Today", "Tomorrow", "Friday" (within a week), otherwise "Wed, Oct 1".
export function formatRelativeDay(date: Date, now: Date): string {
  const days = daysBetween(now, date)
  if (days === 0) return "Today"
  if (days === 1) return "Tomorrow"
  if (days > 1 && days < 7) return formatWeekday(date)
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

// 45 -> "45m", 90 -> "1h 30m", 120 -> "2h"
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}m`
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export function greetingFor(date: Date): string {
  const hour = date.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 17) return "Good afternoon"
  return "Good evening"
}
