import { NextResponse, type NextRequest } from "next/server"
import { getCurrentUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { saveLmsConnection } from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { oauthStateCookieName, verifyOAuthState } from "@/server/integrations/lms/oauth-state"
import { getLmsProvider } from "@/server/integrations/lms/registry"

// GET /api/integrations/canvas/callback: where Canvas sends the student back
// after they approve (or cancel) the connection.
//
//   1. The student must be signed in (the same one who started).
//   2. The OAuth state must match the single-use cookie (CSRF protection).
//   3. The one-time code is exchanged for tokens here, on the server.
//   4. Tokens are stored encrypted; nothing sensitive goes back to the browser.
// The student lands on Settings with a short outcome code (never a token or an
// LMS error message) that the page turns into a friendly message.

const COOKIE = oauthStateCookieName("canvas")

function backToSettings(request: NextRequest, outcome: string) {
  const response = NextResponse.redirect(new URL(`/settings?canvas=${outcome}#integrations`, request.url))
  // The state is single-use, whatever the outcome.
  response.cookies.set(COOKIE, "", { path: "/api/integrations/canvas", maxAge: 0 })
  return response
}

export async function GET(request: NextRequest) {
  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(new URL("/login", request.url))

  const params = request.nextUrl.searchParams
  const error = params.get("error")
  if (error) return backToSettings(request, error === "access_denied" ? "denied" : "error")

  let vault
  try {
    vault = getCredentialVault()
  } catch {
    return backToSettings(request, "not_configured")
  }

  const verified = verifyOAuthState(
    { provider: "canvas", userId: user.id, state: params.get("state"), cookieValue: request.cookies.get(COOKIE)?.value },
    vault
  )
  if (!verified) return backToSettings(request, "invalid_state")
  const code = params.get("code")
  if (!code) return backToSettings(request, "error")

  try {
    const tokens = await getLmsProvider("canvas").exchangeCode({ baseUrl: verified.baseUrl, code })
    await saveLmsConnection(getDb(), user.id, "canvas", { ...tokens, baseUrl: verified.baseUrl }, vault)
  } catch (error) {
    // Only the error's type is logged: provider errors can contain tokens.
    console.error("[canvas] connecting failed", { name: error instanceof Error ? error.name : typeof error })
    return backToSettings(request, "error")
  }
  return backToSettings(request, "connected")
}
