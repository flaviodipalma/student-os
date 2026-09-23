// The student's time zone. "Today", "now" and every date-only deadline are the
// student's local ones, never the server's: a server running on UTC would
// otherwise show tomorrow's date as "today" to a student in New York after 8 PM.
//
// The browser reports its time zone in a cookie (TimeZoneSync); the server reads
// it to work out the student's wall-clock time for the page it renders.

export const TIME_ZONE_COOKIE = "tz"

export function isValidTimeZone(value: string | undefined): value is string {
  if (!value || value.length > 64) return false
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return true
  } catch {
    return false
  }
}

// The wall-clock time in `timeZone` at `instant`, as [year, monthIndex, day, hours, minutes, seconds].
export type WallClock = [number, number, number, number, number, number]

export function wallClockIn(timeZone: string | undefined, instant: Date = new Date()): WallClock {
  if (!isValidTimeZone(timeZone)) {
    return [
      instant.getFullYear(),
      instant.getMonth(),
      instant.getDate(),
      instant.getHours(),
      instant.getMinutes(),
      instant.getSeconds(),
    ]
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant)
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return [part("year"), part("month") - 1, part("day"), part("hour") % 24, part("minute"), part("second")]
}

// A Date whose local fields (getDate, getHours…) show that wall-clock time,
// wherever the code runs. Used so server and browser render the same "now".
export function dateFromWallClock([year, month, day, hours, minutes, seconds]: WallClock): Date {
  return new Date(year, month, day, hours, minutes, seconds)
}

// The instant a wall-clock time happens in `timeZone` (DST-aware, from the zone's
// own rules; no fixed offsets). A time skipped by a DST change lands just after it.
// Without a valid zone, the runtime's own zone is used.
export function instantFromWallClock([year, month, day, hours, minutes, seconds]: WallClock, timeZone: string | undefined): Date {
  if (!isValidTimeZone(timeZone)) return new Date(year, month, day, hours, minutes, seconds)
  const asUtc = Date.UTC(year, month, day, hours, minutes, seconds)
  // The zone's offset at that moment, then corrected once for DST edges.
  let guess = asUtc
  for (let i = 0; i < 2; i++) {
    const [wy, wmo, wd, wh, wmi, ws] = wallClockIn(timeZone, new Date(guess))
    guess -= Date.UTC(wy, wmo, wd, wh, wmi, ws) - asUtc
  }
  return new Date(guess)
}

// "2026-09-29" + "14:30" in the student's zone -> the instant.
export function instantAt(dateKey: string, time: string, timeZone: string | undefined): Date {
  const [year, month, day] = dateKey.split("-").map(Number)
  const [hours, minutes] = time.split(":").map(Number)
  return instantFromWallClock([year, month - 1, day, hours, minutes, 0], timeZone)
}
