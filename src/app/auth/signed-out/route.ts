import { NextResponse, type NextRequest } from "next/server"
import { createSupabaseServerClient, getCurrentUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { logger } from "@/server/log"
import { accountExists } from "@/server/services/account"

// Where the app sends a session whose account no longer exists (deleted on
// another device, or in the Supabase dashboard; the session itself stays valid
// for up to an hour): logs this browser out and opens the log-in page with a
// notice. A session whose account does exist is never logged out here, so
// another site can't use this link to log a student out; it goes back to the app.
export async function GET(request: NextRequest) {
  const to = (path: string) => NextResponse.redirect(new URL(path, request.url))
  const user = await getCurrentUser()
  if (!user) return to("/login")
  try {
    if (await accountExists(getDb(), user.id)) return to("/dashboard")
  } catch {
    // Can't check (database down): leave the session alone; the app shows the database error.
    return to("/dashboard")
  }
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut({ scope: "local" })
  } catch (error) {
    logger.warn("auth", "sign-out of a deleted account failed", { name: error instanceof Error ? error.name : typeof error })
  }
  return to("/login?error=account-gone")
}
