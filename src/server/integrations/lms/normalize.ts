import "server-only"

import { toDateKey } from "@/lib/format"
import { dateFromWallClock, wallClockIn } from "@/lib/time-zone"

// Small conversions every LMS adapter needs.

// HTML fragment (LMS descriptions) -> plain text.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim()
}

// An LMS timestamp (ISO 8601, UTC) -> the student's local date and time.
// Without a known time zone, the server's is used.
export function utcToLocalDue(dueAt: string, timeZone: string | undefined): { dueDate: string; dueTime: string } | null {
  const instant = new Date(dueAt)
  if (Number.isNaN(instant.getTime())) return null
  const local = dateFromWallClock(wallClockIn(timeZone, instant))
  const hh = String(local.getHours()).padStart(2, "0")
  const mm = String(local.getMinutes()).padStart(2, "0")
  return { dueDate: toDateKey(local), dueTime: `${hh}:${mm}` }
}
