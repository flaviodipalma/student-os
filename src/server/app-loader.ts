import "server-only"

import { toDateKey } from "@/lib/format"
import { requireUser, type SessionUser } from "./auth"
import { getDb } from "./db"
import { loadAppData, type AppData } from "./services/app-data"
import { ensureProfile } from "./services/profiles"

export type SignedInApp = { user: SessionUser; now: Date; today: string; data: AppData }

// Everything a signed-in page needs: who is signed in (or a redirect to /login)
// and their data from the database. Returns null if the database can't be reached.
export async function loadSignedInApp(): Promise<SignedInApp | null> {
  const user = await requireUser()
  const now = new Date()
  try {
    const db = getDb()
    await ensureProfile(db, user.id)
    return { user, now, today: toDateKey(now), data: await loadAppData(db, user.id) }
  } catch (error) {
    console.error("[app] couldn't load user data", { name: error instanceof Error ? error.name : typeof error })
    return null
  }
}
