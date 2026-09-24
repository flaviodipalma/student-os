import "server-only"

import { NextResponse, type NextRequest } from "next/server"
import type { LmsProviderId } from "@/lib/types"
import { getCurrentUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { saveLmsConnection } from "./connections"
import { getCredentialVault } from "./credential-vault"
import { oauthCookiePath, oauthStateCookieName, verifyOAuthState } from "./oauth-state"
import { LmsNotApprovedError } from "./provider"
import { getLmsProvider } from "./registry"
import { logger } from "@/server/log"

// GET /api/integrations/<provider>/callback: where the LMS sends the student
// back after they approve (or cancel) the connection. The same for every LMS:
//
//   1. The student must be signed in (the same one who started).
//   2. The OAuth state must match the single-use cookie (CSRF protection).
//   3. The one-time code (with the PKCE verifier from the cookie) is exchanged
//      for tokens here, on the server.
//   4. Tokens are stored encrypted; nothing sensitive goes back to the browser.
// The student lands on Settings with a short outcome code (?canvas=connected,
// ?blackboard=denied, ...), never a token or an LMS error message, which the
// page turns into a friendly message.

export async function handleLmsCallback(request: NextRequest, provider: LmsProviderId): Promise<NextResponse> {
  const cookie = oauthStateCookieName(provider)
  const backToSettings = (outcome: string) => {
    const response = NextResponse.redirect(new URL(`/settings?${provider}=${outcome}#integrations`, request.url))
    // The state is single-use, whatever the outcome.
    response.cookies.set(cookie, "", { path: oauthCookiePath(provider), maxAge: 0 })
    return response
  }

  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(new URL("/login", request.url))

  const params = request.nextUrl.searchParams
  const error = params.get("error")
  if (error) return backToSettings(error === "access_denied" ? "denied" : "error")

  let vault
  try {
    vault = getCredentialVault()
  } catch {
    return backToSettings("not_configured")
  }

  const verified = verifyOAuthState(
    { provider, userId: user.id, state: params.get("state"), cookieValue: request.cookies.get(cookie)?.value },
    vault
  )
  if (!verified) return backToSettings("invalid_state")
  const code = params.get("code")
  if (!code) return backToSettings("error")

  try {
    const lms = getLmsProvider(provider)
    const tokens = await lms.exchangeCode({ baseUrl: verified.baseUrl, code, codeVerifier: verified.codeVerifier })
    await saveLmsConnection(getDb(), user.id, provider, { ...tokens, baseUrl: verified.baseUrl }, vault)
  } catch (error) {
    // Only the error's type is logged: provider errors can contain tokens.
    logger.error(`${provider}`, `connecting failed`, { name: error instanceof Error ? error.name : typeof error })
    return backToSettings(error instanceof LmsNotApprovedError ? "not_approved" : "error")
  }
  return backToSettings("connected")
}
