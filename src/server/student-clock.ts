import "server-only"

import { cookies } from "next/headers"
import { toDateKey } from "@/lib/format"
import { dateFromWallClock, isValidTimeZone, TIME_ZONE_COOKIE, wallClockIn, type WallClock } from "@/lib/time-zone"

export type StudentClock = {
  // The student's wall-clock time right now (see src/lib/time-zone.ts).
  wallClock: WallClock
  // The same time as a Date whose local fields show the student's time.
  now: Date
  // The student's "YYYY-MM-DD".
  today: string
}

// "Now" for the signed-in student, in their time zone (from the browser's cookie;
// the server's own zone until the browser has reported one).
export async function getStudentClock(): Promise<StudentClock> {
  const timeZone = (await cookies()).get(TIME_ZONE_COOKIE)?.value
  const wallClock = wallClockIn(timeZone)
  const now = dateFromWallClock(wallClock)
  return { wallClock, now, today: toDateKey(now) }
}

// The student's IANA time zone (e.g. "America/New_York") as reported by their
// browser, or undefined if it hasn't reported one (or it isn't valid).
export async function getStudentTimeZone(): Promise<string | undefined> {
  const timeZone = (await cookies()).get(TIME_ZONE_COOKIE)?.value
  return isValidTimeZone(timeZone) ? timeZone : undefined
}
