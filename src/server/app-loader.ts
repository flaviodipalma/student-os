import "server-only"

import type { WallClock } from "@/lib/time-zone"
import { requireUser, type SessionUser } from "./auth"
import { getDb } from "./db"
import { loadAppData, type AppData } from "./services/app-data"
import { ensureProfile } from "./services/profiles"
import { getStudentClock, getStudentTimeZone } from "./student-clock"

// wallClock: "now" in the student's time zone, for the shared clock.
// timeZone: the student's IANA zone (undefined until their browser reports it),
// for showing external calendar events (stored as instants) at local times.
export type SignedInApp = { user: SessionUser; wallClock: WallClock; timeZone: string | undefined; data: AppData }

// Everything a signed-in page needs: who is signed in (or a redirect to /login)
// and their data from the database. Returns null if the database can't be reached.
export async function loadSignedInApp(): Promise<SignedInApp | null> {
  const user = await requireUser()
  const { wallClock } = await getStudentClock()
  const timeZone = await getStudentTimeZone()
  try {
    const db = getDb()
    await ensureProfile(db, user.id)
    return { user, wallClock, timeZone, data: await loadAppData(db, user.id) }
  } catch (error) {
    console.error("[app] couldn't load user data", { name: error instanceof Error ? error.name : typeof error })
    return null
  }
}
